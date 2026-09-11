import { describe, expect, it } from 'vitest';

import type { Task } from '@fleet/mission';

import { DagBuildError, buildDag } from './dag.js';
import type { NodeStatus } from './types.js';

/**
 * US1 拓扑矩阵测试（tasks.md T006 / SC-001）：
 * linear / parallel / diamond 状态链 + cycle / missing / self /
 * 重复 id 精确拒绝。
 */

function task(id: string, dependsOn: string[] = []): Task {
  return { id, goal: `goal-${id}`, agentRole: 'reason', dependsOn };
}

function statuses(
  dag: ReturnType<typeof buildDag>,
): Record<string, NodeStatus> {
  return Object.fromEntries(
    dag.snapshot().map((node) => [node.taskId, node.status]),
  );
}

describe('buildDag 合法拓扑', () => {
  it('linear（a→b→c）：就绪逐个出现', () => {
    const dag = buildDag([task('a'), task('b', ['a']), task('c', ['b'])]);
    expect(dag.readyTasks().map((node) => node.taskId)).toEqual(['a']);
    dag.node('a')!.status = 'completed';
    expect(dag.readyTasks().map((node) => node.taskId)).toEqual(['b']);
    dag.node('b')!.status = 'completed';
    expect(dag.readyTasks().map((node) => node.taskId)).toEqual(['c']);
    expect(dag.counts()).toEqual({
      pending: 1,
      running: 0,
      completed: 2,
      failed: 0,
      skipped: 0,
    });
  });

  it('parallel（3 独立）：同批就绪、声明序稳定', () => {
    const dag = buildDag([task('c'), task('a'), task('b')]);
    expect(dag.readyTasks().map((node) => node.taskId)).toEqual([
      'c',
      'a',
      'b',
    ]);
    // 同状态重复查询同结果（FR-003）
    expect(dag.readyTasks().map((node) => node.taskId)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('diamond（a→{b,c}→d）：b/c 在 a 后同时就绪、d 等待两者', () => {
    const dag = buildDag([
      task('a'),
      task('b', ['a']),
      task('c', ['a']),
      task('d', ['b', 'c']),
    ]);
    expect(dag.readyTasks().map((node) => node.taskId)).toEqual(['a']);
    dag.node('a')!.status = 'completed';
    expect(dag.readyTasks().map((node) => node.taskId)).toEqual(['b', 'c']);
    // 仅 b 完成：c 仍就绪（d 还在等 c）——d 不因 b 单独完成而就绪
    dag.node('b')!.status = 'completed';
    expect(dag.readyTasks().map((node) => node.taskId)).toEqual(['c']);
    dag.node('c')!.status = 'completed';
    expect(dag.readyTasks().map((node) => node.taskId)).toEqual(['d']);
  });

  it('空任务列表：合法空图（autonomous 未规划态）', () => {
    const dag = buildDag([]);
    expect(dag.snapshot()).toEqual([]);
    expect(dag.readyTasks()).toEqual([]);
  });

  it('dependents 正向边（传播用）', () => {
    const dag = buildDag([
      task('a'),
      task('b', ['a']),
      task('c', ['a']),
      task('d', ['b']),
    ]);
    expect(dag.dependentsOf('a')).toEqual(['b', 'c']);
    expect(dag.dependentsOf('b')).toEqual(['d']);
    expect(dag.dependentsOf('d')).toEqual([]);
  });
});

describe('buildDag 非法拓扑（构建即拒绝，SC-001）', () => {
  it('cycle（a→b→c→a）：拒绝并报出精确环链', () => {
    try {
      buildDag([task('a', ['c']), task('b', ['a']), task('c', ['b'])]);
      expect.unreachable('应当抛出 DagBuildError');
    } catch (error) {
      expect(error).toBeInstanceOf(DagBuildError);
      const issues = (error as DagBuildError).context['issues'] as Array<{
        received: string;
        message: string;
      }>;
      const cycleIssue = issues.find((issue) =>
        issue.message.includes('依赖环'),
      );
      expect(cycleIssue?.received.split(' -> ')).toEqual(['a', 'c', 'b', 'a']);
    }
  });

  it('missing（悬空依赖）：拒绝并定位 dependsOn', () => {
    try {
      buildDag([task('a'), task('b', ['ghost'])]);
      expect.unreachable();
    } catch (error) {
      const issues = (error as DagBuildError).context['issues'] as Array<{
        path: string;
        message: string;
      }>;
      expect(
        issues.some(
          (issue) =>
            issue.path === 'tasks.1.dependsOn' &&
            issue.message.includes('悬空依赖：b 依赖的 ghost'),
        ),
      ).toBe(true);
    }
  });

  it('self（自环）：拒绝', () => {
    try {
      buildDag([task('a', ['a'])]);
      expect.unreachable();
    } catch (error) {
      const issues = (error as DagBuildError).context['issues'] as Array<{
        message: string;
      }>;
      expect(issues.some((issue) => issue.message.includes('自环'))).toBe(true);
    }
  });

  it('双节点互环（a↔b）：拒绝并报链', () => {
    try {
      buildDag([task('a', ['b']), task('b', ['a'])]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DagBuildError);
    }
  });

  it('重复 task id：拒绝标双位置', () => {
    try {
      buildDag([task('a'), task('b'), task('a')]);
      expect.unreachable();
    } catch (error) {
      const issues = (error as DagBuildError).context['issues'] as Array<{
        path: string;
        message: string;
      }>;
      expect(
        issues.some(
          (issue) =>
            issue.path === 'tasks.2.id' && issue.message.includes('tasks.0'),
        ),
      ).toBe(true);
    }
  });

  it('多问题一次报全（重复 id + 悬空 + 自环）', () => {
    try {
      buildDag([task('a'), task('a'), task('b', ['ghost', 'b'])]);
      expect.unreachable();
    } catch (error) {
      const issues = (error as DagBuildError).context['issues'] as unknown[];
      expect(issues.length).toBe(3);
    }
  });
});

describe('snapshot 形状', () => {
  it('含 attempts 与可选字段的纯数据视图', () => {
    const dag = buildDag([task('a')]);
    const node = dag.node('a')!;
    node.attempts = 2;
    node.failureReason = 'x';
    expect(dag.snapshot()).toEqual([
      { taskId: 'a', status: 'pending', attempts: 2, failureReason: 'x' },
    ]);
    void statuses;
  });
});
