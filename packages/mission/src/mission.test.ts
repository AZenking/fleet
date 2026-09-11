import { describe, expect, it } from 'vitest';

import type { ConfigIssue } from '@fleet/core';

import { loadMission } from './loader.js';
import { validateSemantics } from './semantic.js';
import type { Mission } from './types.js';
import { artifactSchema, runSchema, taskRunSchema } from './types.js';

/**
 * Foundational 单元测试（tasks.md T007/T013）：结构矩阵 + 语义
 * 规则矩阵 + Artifact/Run 契约样例。纯函数，不触磁盘。
 */

const VALID = `
id: demo
goal: 测试目标
planningMode: execution
requirements:
  - id: req-1
    text: 需求一
constraints:
  - kind: maxTokens
    value: 1000
plan:
  summary: 已确认方案
tasks:
  - id: analyze
    goal: 分析
    agentRole: focus
    dependsOn: []
  - id: build
    goal: 实现
    agentRole: reason
    dependsOn: [analyze]
acceptance:
  - given: 初始
    when: 执行
    then: 通过
`;

function loadOrThrow(raw: string): Mission {
  return loadMission(raw, { sourcePath: '<test>' });
}

function issuesOf(raw: string): ConfigIssue[] {
  try {
    loadOrThrow(raw);
  } catch (error) {
    const context = (error as { context?: { issues?: ConfigIssue[] } }).context;
    if (Array.isArray(context?.issues)) {
      return context.issues;
    }
  }
  return [];
}

describe('loadMission（结构层矩阵）', () => {
  it('合法 execution mission 解析为强类型实体', () => {
    const mission = loadOrThrow(VALID);
    expect(mission.id).toBe('demo');
    expect(mission.planningMode).toBe('execution');
    expect(mission.tasks?.[1]?.dependsOn).toEqual(['analyze']);
    expect(mission.constraints[0]).toEqual({ kind: 'maxTokens', value: 1000 });
  });

  it('缺 goal → required 错误含字段路径', () => {
    const issues = issuesOf(VALID.replace('goal: 测试目标\n', ''));
    expect(issues.some((issue) => issue.path === 'goal')).toBe(true);
  });

  it('planningMode 非法值 → 枚举错误列出合法值（大小写敏感）', () => {
    const issues = issuesOf(
      VALID.replace('planningMode: execution', 'planningMode: Execution'),
    );
    const hit = issues.find((issue) => issue.path === 'planningMode');
    expect(hit?.expected).toContain('autonomous | execution');
  });

  it('未知字段（拼错 acceptences）→ 拒绝且逐字段列出', () => {
    const issues = issuesOf(`${VALID}acceptences: []\n`);
    const hit = issues.find((issue) => issue.path === 'acceptences');
    expect(hit?.received).toBe('未知字段');
  });

  it('非对象顶层（数组）→ 结构错误（顶层应为映射）', () => {
    let caught: Error | undefined;
    try {
      loadMission('- a\n- b\n');
    } catch (error) {
      caught = error instanceof Error ? error : new Error(String(error));
    }
    expect(caught?.message).toContain('结构错误');
    const issues = (caught as { context?: { issues?: ConfigIssue[] } }).context
      ?.issues;
    expect(issues?.[0]?.message).toContain('顶层应为映射');
  });

  it('多文档 YAML → 拒绝（单文件单 mission）', () => {
    expect(() => loadMission(`${VALID}---\nid: another\n`)).toThrow(/解析失败/);
  });

  it('非法角色 coder → 五角色枚举错误', () => {
    const issues = issuesOf(
      VALID.replace('agentRole: focus', 'agentRole: coder'),
    );
    const hit = issues.find((issue) => issue.path === 'tasks.0.agentRole');
    expect(hit?.expected).toContain('wisdom');
  });

  it('约束非法：未知 kind / 负值', () => {
    expect(
      issuesOf(VALID.replace('kind: maxTokens', 'kind: maxCost')).some(
        (issue) => issue.path.startsWith('constraints.0'),
      ),
    ).toBe(true);
    expect(
      issuesOf(VALID.replace('value: 1000', 'value: -5')).some((issue) =>
        issue.path.startsWith('constraints.0'),
      ),
    ).toBe(true);
  });

  it('嵌套非对象项（tasks.1 是字符串）→ 定位到 tasks.1', () => {
    const issues = issuesOf(
      VALID.replace(
        '  - id: build\n    goal: 实现\n    agentRole: reason\n    dependsOn: [analyze]',
        '  - bad-string',
      ),
    );
    expect(issues.some((issue) => issue.path.startsWith('tasks.1'))).toBe(true);
  });

  it('id 命名规则：-x 拒绝、ok-id 通过', () => {
    expect(
      issuesOf(VALID.replace('id: demo', 'id: -x')).some(
        (i) => i.path === 'id',
      ),
    ).toBe(true);
    expect(() =>
      loadOrThrow(VALID.replace('id: demo', 'id: ok-id')),
    ).not.toThrow();
  });
});

describe('validateSemantics（语义层矩阵）', () => {
  it('合法 mission：零 issue', () => {
    expect(validateSemantics(loadOrThrow(VALID))).toEqual([]);
  });

  it('task id 重复 → 标出后发位置与首见位置', () => {
    const issues = validateSemantics(
      loadOrThrow(VALID.replace('id: build', 'id: analyze')),
    );
    const hit = issues.find((issue) => issue.path === 'tasks.1.id');
    expect(hit?.message).toContain('首见 tasks.0');
  });

  it('悬空依赖 → 引用方与被引 id', () => {
    const issues = validateSemantics(
      loadOrThrow(VALID.replace('dependsOn: [analyze]', 'dependsOn: [ghost]')),
    );
    const hit = issues.find((issue) => issue.path === 'tasks.1.dependsOn');
    expect(hit?.received).toBe('ghost');
    expect(hit?.message).toContain('悬空依赖');
  });

  it('自环依赖 → 拒绝', () => {
    const issues = validateSemantics(
      loadOrThrow(VALID.replace('dependsOn: [analyze]', 'dependsOn: [build]')),
    );
    expect(issues.some((issue) => issue.message.includes('自环'))).toBe(true);
  });

  it('execution 缺 plan → 错误说明模式要求（US2 场景 2）', () => {
    const raw = VALID.replace('plan:\n  summary: 已确认方案\n', '');
    const issues = validateSemantics(loadOrThrow(raw));
    const hit = issues.find((issue) => issue.path === 'plan');
    expect(hit?.message).toContain('execution 模式要求 plan');
  });

  it('execution 缺 tasks → 错误说明模式要求', () => {
    const raw =
      VALID.slice(0, VALID.indexOf('tasks:')) +
      VALID.slice(VALID.indexOf('acceptance:'));
    const issues = validateSemantics(loadOrThrow(raw));
    expect(
      issues.some(
        (issue) =>
          issue.path === 'tasks' && issue.message.includes('execution'),
      ),
    ).toBe(true);
  });

  it('autonomous 极简（无 plan/tasks）→ 零 issue', () => {
    const raw = `
id: auto-demo
goal: 探索
planningMode: autonomous
requirements:
  - text: 调研
acceptance:
  - given: 无
    when: 完成调研
    then: 结论
`;
    expect(validateSemantics(loadOrThrow(raw))).toEqual([]);
  });

  it('requirement id 重复 → 后发位置报错', () => {
    const raw = VALID.replace(
      'requirements:\n  - id: req-1\n    text: 需求一',
      'requirements:\n  - id: req-1\n    text: 需求一\n  - id: req-1\n    text: 需求二',
    );
    const issues = validateSemantics(loadOrThrow(raw));
    const hit = issues.find((issue) => issue.path === 'requirements.1.id');
    expect(hit?.message).toContain('requirements.0');
  });

  it('多规则并发 → 一次报全（SC-003）', () => {
    // 同时：悬空依赖 + 自环 + execution 缺 plan
    const raw = VALID.replace(
      'dependsOn: [analyze]',
      'dependsOn: [ghost, build]',
    ).replace('plan:\n  summary: 已确认方案\n', '');
    const issues = validateSemantics(loadOrThrow(raw));
    expect(issues.length).toBe(3);
  });
});

describe('Artifact / Run schema（T013 契约基线）', () => {
  it('Artifact 合法样例', () => {
    expect(
      artifactSchema.safeParse({
        id: 'art_findings-1',
        taskId: 'analyze',
        kind: 'findings',
        payload: { refs: [] },
        createdAt: '2026-09-11T00:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('Artifact 非法：坏前缀 / 缺 createdAt', () => {
    expect(
      artifactSchema.safeParse({
        id: 'findings-1',
        taskId: 'analyze',
        kind: 'findings',
        payload: {},
        createdAt: '2026-09-11T00:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      artifactSchema.safeParse({
        id: 'art_x',
        taskId: 'analyze',
        kind: 'findings',
        payload: {},
      }).success,
    ).toBe(false);
  });

  it('Run / TaskRun 合法样例（status 枚举含 skipped）', () => {
    expect(
      runSchema.safeParse({
        id: 'run_demo-1',
        missionId: 'demo',
        status: 'running',
        taskRuns: [
          { taskId: 'analyze', status: 'skipped', agentRole: 'focus' },
        ],
      }).success,
    ).toBe(true);
  });

  it('Run 非法：坏前缀 / 非法状态', () => {
    expect(
      runSchema.safeParse({
        id: 'demo-1',
        missionId: 'demo',
        status: 'running',
      }).success,
    ).toBe(false);
    expect(
      taskRunSchema.safeParse({
        taskId: 'analyze',
        status: 'paused',
        agentRole: 'focus',
      }).success,
    ).toBe(false);
  });
});

describe('M9 验收策略字段（validation / maxReviewLoops）', () => {
  it('合法显式配置解析为强类型实体', () => {
    const mission = loadOrThrow(`
id: v9
goal: 验证门
planningMode: execution
requirements:
  - text: 需求
plan:
  summary: 方案
tasks:
  - id: impl
    goal: 实现
    agentRole: reason
validation:
  commands:
    lint: ./checks/lint.sh
    tests: ./checks/tests.sh
  timeoutMs: 60000
maxReviewLoops: 2
acceptance:
  - given: 无
    when: 执行
    then: 完成
`);
    expect(mission.validation).toEqual({
      commands: { lint: './checks/lint.sh', tests: './checks/tests.sh' },
      timeoutMs: 60000,
    });
    expect(mission.maxReviewLoops).toBe(2);
  });

  it('maxReviewLoops = 0 合法（纯验证门）；既有 mission 无新字段照常解析', () => {
    const gated = loadOrThrow(
      VALID.replace('acceptance:', 'maxReviewLoops: 0\nacceptance:'),
    );
    expect(gated.maxReviewLoops).toBe(0);
    expect(gated.validation).toBeUndefined();
    expect(loadOrThrow(VALID).maxReviewLoops).toBeUndefined();
  });

  it('非法值拒绝：负数轮次 / 非正超时 / 未知命令键', () => {
    expect(
      issuesOf(VALID.replace('acceptance:', 'maxReviewLoops: -1\nacceptance:')),
    ).toHaveLength(1);
    expect(
      issuesOf(
        VALID.replace(
          'acceptance:',
          'validation:\n  timeoutMs: 0\nacceptance:',
        ),
      ),
    ).toHaveLength(1);
    expect(
      issuesOf(
        VALID.replace(
          'acceptance:',
          'validation:\n  commands:\n    format: prettier .\nacceptance:',
        ),
      ),
    ).toHaveLength(1);
  });
});
