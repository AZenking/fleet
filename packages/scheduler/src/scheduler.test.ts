import { describe, expect, it } from 'vitest';

import type { Task } from '@fleet/mission';

import { buildDag } from './dag.js';
import { Scheduler, type SchedulerConfig } from './scheduler.js';
import type { TaskExecutionResult, TaskExecutor } from './types.js';
import { ScriptedExecutor } from './test-kit.js';
import { resolveSchedulerConfig } from './config.js';

/**
 * US2 并发（T008）/ US3 失败传播与终态（T009）/ 确定性（T010）。
 */

function task(id: string, dependsOn: string[] = []): Task {
  return { id, goal: `goal-${id}`, agentRole: 'reason', dependsOn };
}

function nodeMap(outcome: {
  nodes: Array<{ taskId: string; status: string }>;
}) {
  return Object.fromEntries(
    outcome.nodes.map((node) => [node.taskId, node.status]),
  );
}

describe('US2：调度循环与真实并发（SC-002 / SC-003）', () => {
  it('3×120ms 无依赖任务真实并发：总耗时 < 300ms（串行基线 360ms）', async () => {
    const executor = new ScriptedExecutor({
      script: { a: ['success'], b: ['success'], c: ['success'] },
      delayMs: 120,
    });
    const outcome = await new Scheduler().run(
      buildDag([task('a'), task('b'), task('c')]),
      executor,
    );
    expect(outcome.status).toBe('completed');
    expect(outcome.durationMs).toBeLessThan(300);
    expect(executor.peak).toBe(3);
  });

  it('5 就绪 + maxConcurrency=3：峰值恰 3、前批 3 后批 2（SC-003）', async () => {
    const executor = new ScriptedExecutor({
      script: Object.fromEntries(
        ['a', 'b', 'c', 'd', 'e'].map((id) => [id, ['success']]),
      ),
      delayMs: 30,
    });
    const outcome = await new Scheduler({ maxConcurrency: 3 }).run(
      buildDag([task('a'), task('b'), task('c'), task('d'), task('e')]),
      executor,
    );
    expect(outcome.status).toBe('completed');
    expect(executor.peak).toBe(3); // 恒 ≤ 3，且达到 3
    expect(outcome.dispatchOrder).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('linear：逐批派发、dispatchOrder 保序', async () => {
    const executor = new ScriptedExecutor({
      script: { a: ['success'], b: ['success'], c: ['success'] },
    });
    const outcome = await new Scheduler().run(
      buildDag([task('a'), task('b', ['a']), task('c', ['b'])]),
      executor,
    );
    expect(outcome.dispatchOrder).toEqual(['a', 'b', 'c']);
    expect(outcome.status).toBe('completed');
  });

  it('maxConcurrency=1：退化为串行，语义不变', async () => {
    const executor = new ScriptedExecutor({
      script: { a: ['success'], b: ['success'] },
      delayMs: 20,
    });
    const outcome = await new Scheduler({ maxConcurrency: 1 }).run(
      buildDag([task('a'), task('b')]),
      executor,
    );
    expect(executor.peak).toBe(1);
    expect(outcome.status).toBe('completed');
  });

  it('diamond：b/c 同批并发，d 等两者完成后派发', async () => {
    const executor = new ScriptedExecutor({
      script: {
        a: ['success'],
        b: ['success'],
        c: ['success'],
        d: ['success'],
      },
      delayMs: 20,
    });
    const outcome = await new Scheduler().run(
      buildDag([
        task('a'),
        task('b', ['a']),
        task('c', ['a']),
        task('d', ['b', 'c']),
      ]),
      executor,
    );
    expect(outcome.dispatchOrder).toEqual(['a', 'b', 'c', 'd']);
    expect(executor.peak).toBe(2);
    expect(outcome.status).toBe('completed');
  });

  it('配置边界：maxConcurrency=0 / retry=-1 拒绝（FR-005/006）', () => {
    expect(() =>
      resolveSchedulerConfig({ maxConcurrency: 0 } as Partial<SchedulerConfig>),
    ).toThrow();
    expect(() =>
      resolveSchedulerConfig({ retry: -1 } as Partial<SchedulerConfig>),
    ).toThrow();
    expect(resolveSchedulerConfig()).toEqual({ maxConcurrency: 3, retry: 1 });
  });
});

describe('US3：失败传播与终态（SC-004 / SC-005）', () => {
  it('必败任务：恰执行 retry+1=2 次后终态 failed（SC-004）', async () => {
    const executor = new ScriptedExecutor({
      script: { a: ['failure', 'failure'] },
    });
    const outcome = await new Scheduler().run(buildDag([task('a')]), executor);
    expect(outcome.status).toBe('failed');
    expect(executor.callsOf('a')).toBe(2);
    const a = outcome.nodes.find((node) => node.taskId === 'a')!;
    expect(a.status).toBe('failed');
    expect(a.attempts).toBe(2);
    expect(a.failureReason).toContain('模拟失败');
  });

  it('重试即成功（一败一成）：终态 completed，下游照常（SC-004 场景 5）', async () => {
    const executor = new ScriptedExecutor({
      script: { a: ['failure', 'success'], b: ['success'] },
    });
    const outcome = await new Scheduler().run(
      buildDag([task('a'), task('b', ['a'])]),
      executor,
    );
    expect(outcome.status).toBe('completed');
    expect(nodeMap(outcome)).toEqual({ a: 'completed', b: 'completed' });
    expect(outcome.dispatchOrder).toEqual(['a', 'a', 'b']);
  });

  it('传播：a→{b 必败,c}→d——d skipped + skippedBy + 链（SC-005）', async () => {
    const executor = new ScriptedExecutor({
      script: {
        a: ['success'],
        b: ['failure', 'failure'],
        c: ['success'],
        d: ['success'],
      },
    });
    const outcome = await new Scheduler().run(
      buildDag([
        task('a'),
        task('b', ['a']),
        task('c', ['a']),
        task('d', ['b', 'c']),
      ]),
      executor,
    );
    expect(outcome.status).toBe('failed');
    expect(nodeMap(outcome)).toEqual({
      a: 'completed',
      b: 'failed',
      c: 'completed',
      d: 'skipped',
    });
    const d = outcome.nodes.find((node) => node.taskId === 'd')!;
    expect(d.skippedBy).toBe('b');
    expect(d.attempts).toBe(0); // skipped 不执行不重试
    expect(outcome.propagation).toEqual([
      { failedTaskId: 'b', skipped: ['d'] },
    ]);
    expect(executor.callsOf('d')).toBe(0);
  });

  it('传递传播：失败隔层传播到叶子', async () => {
    const executor = new ScriptedExecutor({
      script: {
        root: ['failure', 'failure'],
        mid: ['success'],
        leaf: ['success'],
        free: ['success'],
      },
    });
    const outcome = await new Scheduler().run(
      buildDag([
        task('root'),
        task('mid', ['root']),
        task('leaf', ['mid']),
        task('free'),
      ]),
      executor,
    );
    expect(nodeMap(outcome)).toEqual({
      root: 'failed',
      mid: 'skipped',
      leaf: 'skipped',
      free: 'completed', // 无依赖任务照常完成
    });
    expect(outcome.propagation).toEqual([
      { failedTaskId: 'root', skipped: ['mid', 'leaf'] },
    ]);
  });

  it('终态三态矩阵：全 completed / 含 failed / 空图 completed', async () => {
    const okExecutor = new ScriptedExecutor({
      script: { a: ['success'] },
    });
    expect(
      (await new Scheduler().run(buildDag([task('a')]), okExecutor)).status,
    ).toBe('completed');

    const failExecutor = new ScriptedExecutor({ script: { a: ['failure'] } });
    expect(
      (await new Scheduler().run(buildDag([task('a')]), failExecutor)).status,
    ).toBe('failed');

    expect((await new Scheduler().run(buildDag([]), okExecutor)).status).toBe(
      'completed',
    );
  });

  it('执行器抛异常 ≡ 失败：不击穿循环、重试后仍败 → failed', async () => {
    const executor = new ScriptedExecutor({
      script: { a: ['boom', 'boom'] },
    });
    const outcome = await new Scheduler().run(buildDag([task('a')]), executor);
    expect(outcome.status).toBe('failed');
    const a = outcome.nodes.find((node) => node.taskId === 'a')!;
    expect(a.failureReason).toContain('执行器异常');
  });

  it('retry=0：失败即终态（执行 1 次）', async () => {
    const executor = new ScriptedExecutor({ script: { a: ['failure'] } });
    const outcome = await new Scheduler({ retry: 0 }).run(
      buildDag([task('a')]),
      executor,
    );
    expect(executor.callsOf('a')).toBe(1);
    expect(outcome.status).toBe('failed');
  });
});

describe('SC-006：确定性（双跑逐项一致）', () => {
  it('同 DAG + 同脚本：dispatchOrder 与终态完全一致', async () => {
    const tasks = [
      task('a'),
      task('b', ['a']),
      task('c', ['a']),
      task('d', ['b', 'c']),
      task('e'),
    ];
    const script = {
      a: ['success'],
      b: ['failure', 'success'],
      c: ['success'],
      d: ['success'],
      e: ['success'],
    };
    const runOnce = async () =>
      new Scheduler().run(buildDag(tasks), new ScriptedExecutor({ script }));
    const first = await runOnce();
    const second = await runOnce();
    expect(second.dispatchOrder).toEqual(first.dispatchOrder);
    expect(second.nodes).toEqual(first.nodes);
    expect(second.propagation).toEqual(first.propagation);
    expect(second.status).toBe(first.status);
  });

  it('失败传播场景双跑一致（含 skipped 与链）', async () => {
    const tasks = [task('a'), task('b', ['a']), task('c', ['b']), task('free')];
    const script = {
      a: ['success'],
      b: ['failure'],
      c: ['success'],
      free: ['success'],
    };
    const runOnce = async () =>
      new Scheduler().run(buildDag(tasks), new ScriptedExecutor({ script }));
    const first = await runOnce();
    const second = await runOnce();
    expect(second.dispatchOrder).toEqual(first.dispatchOrder);
    expect(second.propagation).toEqual(first.propagation);
    expect(nodeMap(second)).toEqual(nodeMap(first));
  });
});

describe('M9 终态信号（retryable=false）', () => {
  it('确定性结论不重试：失败 1 次即终态 failed（attempts=1）', async () => {
    const executor = new ScriptedExecutor({ script: { a: ['failure'] } });
    const terminal = new (class implements TaskExecutor {
      calls = 0;
      execute(): Promise<TaskExecutionResult> {
        this.calls += 1;
        return Promise.resolve({
          ok: false,
          detail: 'review_exceeded：审阅轮次耗尽',
          retryable: false,
        });
      }
    })();
    const outcome = await new Scheduler().run(buildDag([task('a')]), terminal);
    expect(outcome.status).toBe('failed');
    expect(terminal.calls).toBe(1); // 不重试——重试不改判
    const a = outcome.nodes.find((node) => node.taskId === 'a')!;
    expect(a.status).toBe('failed');
    expect(a.attempts).toBe(1);
    expect(a.failureReason).toContain('review_exceeded');
    void executor;
  });

  it('缺省失败照旧重试（回归：retry+1 次）', async () => {
    const executor = new ScriptedExecutor({
      script: { a: ['failure', 'failure'] },
    });
    const outcome = await new Scheduler().run(buildDag([task('a')]), executor);
    expect(executor.callsOf('a')).toBe(2);
    expect(outcome.nodes.find((node) => node.taskId === 'a')!.attempts).toBe(2);
  });
});
