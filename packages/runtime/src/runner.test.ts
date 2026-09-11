import { describe, expect, it } from 'vitest';

import { MemoryFileSystem } from '@fleet/core';
import { runSchema, taskRunSchema } from '@fleet/mission';

import { MissionRuntimeBridge } from './bridge.js';
import { FakeRuntimeAdapter } from './fake.js';
import { runMissionFile, type MissionRunEvent } from './runner.js';
import type { TaskExecutor } from '@fleet/scheduler';

/**
 * US3：桥接规则与 runner 编排（tasks.md T010/T011）。
 * 请求字段断言 / timeout 推导三档 / RunReport 自校验 / 事件顺序 /
 * 非法 mission 零执行 / autonomous note。
 */

function taskYaml(
  id: string,
  agentRole = 'reason',
  dependsOn = '',
  constraints = '',
): string {
  return `  - id: ${id}\n    goal: 目标-${id}\n    agentRole: ${agentRole}${dependsOn}${constraints}\n`;
}

function missionYaml(input: {
  tasks: string;
  constraints?: string;
  taskRunsExtra?: string;
}): string {
  return `
id: bridge-demo
goal: 桥接测试
planningMode: execution
requirements:
  - text: 需求
${input.constraints ?? ''}
plan:
  summary: 已确认
tasks:
${input.tasks}
acceptance:
  - given: 无
    when: 执行
    then: 完成
`;
}

/** MemoryFileSystem 构造函数不收参——显式写文件 */
function fsWith(yaml: string): MemoryFileSystem {
  const fs = new MemoryFileSystem();
  fs.writeFile('/repo/missions/demo.yaml', yaml);
  return fs;
}

describe('MissionRuntimeBridge 规则（research.md D5）', () => {
  it('请求字段齐备：runId 前缀且每次执行唯一 / agentId / prompt 模板 / cwd', async () => {
    const fake = new FakeRuntimeAdapter({
      script: { t1: [{ outcome: 'failure' }, { outcome: 'success' }] },
    });
    const bridge = new MissionRuntimeBridge(fake, { cwd: '/repo' });
    const task = {
      id: 't1',
      goal: '做点事',
      agentRole: 'focus' as const,
      dependsOn: [],
    };
    await bridge.execute(task);
    await bridge.execute(task); // 重试 = 新 runId
    expect(bridge.requests).toHaveLength(2);
    expect(bridge.requests[0]!.runId).toMatch(/^run_/);
    expect(bridge.requests[0]!.runId).not.toBe(bridge.requests[1]!.runId);
    const [req] = fake.requests;
    expect(req.agentId).toBe('agent:t1');
    expect(req.prompt).toBe('[任务 t1] 做点事');
    expect(req.cwd).toBe('/repo');
    expect(req.env?.FLEET_AGENT_ROLE).toBe('focus');
  });

  it('timeoutMs 推导三档：task 级 > mission 级 > 默认 5000', async () => {
    // 默认档
    const fakeDefault = new FakeRuntimeAdapter();
    const bridgeDefault = new MissionRuntimeBridge(fakeDefault, {
      cwd: '/repo',
    });
    await bridgeDefault.execute({
      id: 'a',
      goal: 'g',
      agentRole: 'reason',
      dependsOn: [],
    });
    expect(bridgeDefault.perTaskTimeoutMs.get('a')).toBe(5000);

    // mission 档
    const bridgeMission = new MissionRuntimeBridge(
      fakeDefault,
      { cwd: '/repo' },
      { missionMaxDurationMs: 3600_000 },
    );
    await bridgeMission.execute({
      id: 'b',
      goal: 'g',
      agentRole: 'reason',
      dependsOn: [],
    });
    expect(bridgeMission.perTaskTimeoutMs.get('b')).toBe(3_600_000);

    // task 档覆盖 mission 档
    const bridgeTask = new MissionRuntimeBridge(
      fakeDefault,
      { cwd: '/repo' },
      { missionMaxDurationMs: 3600_000 },
    );
    await bridgeTask.execute({
      id: 'c',
      goal: 'g',
      agentRole: 'reason',
      dependsOn: [],
      constraints: [{ kind: 'maxDurationMs', value: 1000 }],
    });
    expect(bridgeTask.perTaskTimeoutMs.get('c')).toBe(1000);
  });
});

describe('runMissionFile 编排', () => {
  it('合法 execution mission：completed + RunReport 过 M4 schema + 事件顺序', async () => {
    const yaml = missionYaml({
      tasks: taskYaml('a') + taskYaml('b', 'reason', '\n    dependsOn: [a]'),
      constraints: 'constraints:\n  - kind: maxDurationMs\n    value: 60000\n',
    });
    const fs = fsWith(yaml);
    const fake = new FakeRuntimeAdapter({ zeroDelays: true });
    const events: MissionRunEvent[] = [];
    const outcome = await runMissionFile('/repo/missions/demo.yaml', {
      fs,
      runtime: fake,
      cwd: '/repo',
      emitEvent: (event) => events.push(event),
    });

    expect(outcome.kind).toBe('completed');
    if (outcome.kind !== 'completed') {
      return;
    }
    const report = outcome.report;
    // SC-006：M4 schema 自校验
    expect(() => runSchema.parse(report.run)).not.toThrow();
    for (const taskRun of report.run.taskRuns) {
      expect(() => taskRunSchema.parse(taskRun)).not.toThrow();
    }
    expect(report.outcome.dispatchOrder).toEqual(['a', 'b']);
    expect(report.runtime.perTaskTimeoutMs).toEqual({ a: 60000, b: 60000 });
    // 事件顺序：started 先、终态最后
    expect(events.map((event) => event.type)).toEqual([
      'mission.run.started',
      'mission.run.completed',
    ]);
    // 时间戳：执行过的任务带最后执行时间
    const a = report.run.taskRuns.find((run) => run.taskId === 'a');
    expect(a?.startedAt).toBeDefined();
    expect(a?.endedAt).toBeDefined();
  });

  it('必败 mission：attempts=2 + 传播 + 事件 failed', async () => {
    const yaml = missionYaml({
      tasks:
        taskYaml('bad') +
        taskYaml('down', 'reason', '\n    dependsOn: [bad]') +
        taskYaml('free', 'reflex'),
    });
    const fs = fsWith(yaml);
    const fake = new FakeRuntimeAdapter({
      script: {
        bad: [{ outcome: 'failure' }, { outcome: 'failure' }],
        down: [{ outcome: 'success' }],
        free: [{ outcome: 'success' }],
      },
      zeroDelays: true,
    });
    const events: MissionRunEvent[] = [];
    const outcome = await runMissionFile('/repo/missions/demo.yaml', {
      fs,
      runtime: fake,
      emitEvent: (event) => events.push(event),
    });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') {
      return;
    }
    const bad = outcome.report.outcome.nodes.find((n) => n.taskId === 'bad');
    expect(bad?.attempts).toBe(2);
    expect(fake.requestsFor('agent:bad')).toHaveLength(2);
    const down = outcome.report.outcome.nodes.find((n) => n.taskId === 'down');
    expect(down?.status).toBe('skipped');
    expect(fake.requestsFor('agent:down')).toHaveLength(0);
    expect(events.at(-1)?.type).toBe('mission.run.failed');
  });

  it('autonomous 无任务：completed + note + 零执行', async () => {
    const yaml = `
id: auto-run
goal: 探索
planningMode: autonomous
requirements:
  - text: 调研
acceptance:
  - given: 无
    when: 调研
    then: 结论
`;
    const fs = fsWith(yaml);
    const fake = new FakeRuntimeAdapter();
    const events: MissionRunEvent[] = [];
    const outcome = await runMissionFile('/repo/missions/demo.yaml', {
      fs,
      runtime: fake,
      emitEvent: (event) => events.push(event),
    });
    expect(outcome.kind).toBe('completed');
    if (outcome.kind === 'completed') {
      expect(outcome.report.note).toContain('Reason 规划属 M7');
      expect(fake.requests).toHaveLength(0);
    }
    expect(events.at(-1)?.type).toBe('mission.run.completed');
  });

  it('非法 mission：校验前置拒绝、零执行（US1 场景 2）', async () => {
    const yaml = missionYaml({ tasks: taskYaml('a', 'coder') }); // 非法角色
    const fs = fsWith(yaml);
    const fake = new FakeRuntimeAdapter();
    const outcome = await runMissionFile('/repo/missions/demo.yaml', {
      fs,
      runtime: fake,
    });
    expect(outcome.kind).toBe('invalid');
    expect(fake.requests).toHaveLength(0); // 未执行任何任务
    if (outcome.kind === 'invalid') {
      expect(
        outcome.validation.issues.some((issue) =>
          issue.path.startsWith('tasks.0.agentRole'),
        ),
      ).toBe(true);
    }
  });

  it('文件不存在：fileError 态', async () => {
    const outcome = await runMissionFile('/repo/missions/nope.yaml', {
      fs: new MemoryFileSystem(),
    });
    expect(outcome.kind).toBe('invalid');
  });
});

describe('M9 RunReport.reviews（duck-typing 合成）', () => {
  it('执行器带 reviews 面 → 透传进报告；缺省不影响既有报告', async () => {
    const yaml = missionYaml({ tasks: taskYaml('a') });
    const fs = fsWith(yaml);
    const reviewPackage = {
      taskId: 'a',
      terminal: 'approved',
      rounds: 0,
      maxReviewLoops: 2,
      artifacts: [],
      verdicts: [],
      diffStat: { files: 1, insertions: 1, deletions: 0 },
    };
    const reportingExecutor = {
      reviews: [reviewPackage],
      taskTimings: new Map(),
      perTaskTimeoutMs: new Map(),
      async execute() {
        return { ok: true };
      },
    } as TaskExecutor & { reviews: unknown[] };
    const withReviews = await runMissionFile('/repo/missions/demo.yaml', {
      fs,
      cwd: '/repo',
      makeExecutor: () => reportingExecutor,
    });
    expect(withReviews.kind).toBe('completed');
    if (withReviews.kind === 'completed') {
      expect(withReviews.report.reviews).toEqual([reviewPackage]);
    }

    const without = await runMissionFile('/repo/missions/demo.yaml', {
      fs,
      cwd: '/repo',
    });
    expect(without.kind).toBe('completed');
    if (without.kind === 'completed') {
      expect(without.report.reviews).toBeUndefined();
      expect(without.report.workspaces).toBeUndefined();
    }
  });
});
