import { describe, expect, it } from 'vitest';
import { loadMission, type Task } from '@fleet/mission';
import type { GateEvaluation } from '@fleet/workspace';

import { ValidationReviewGate } from './gate.js';
import type {
  ArtifactOverall,
  ReviewOutcome,
  Reviewer,
  ValidationArtifact,
  ValidationEvent,
  Validator,
} from './types.js';

/**
 * T010 循环编排（SC-003）：三路径 / 上限不变式（无第 3 轮修复）/
 * fail-closed / 事件序 / packages 全轮次。Fake runner + reviewer 注入。
 */

const mission = loadMission(
  `
id: g10
goal: 循环测试目标
planningMode: execution
requirements:
  - text: 需求
plan:
  summary: 方案
tasks:
  - id: impl-a
    goal: 实现 A
    agentRole: reason
acceptance:
  - given: 无
    when: 执行
    then: 完成
`,
  { sourcePath: '<test>' },
);

const task: Task = {
  id: 'impl-a',
  goal: '实现 A',
  agentRole: 'reason',
  dependsOn: [],
};

function artifactOf(
  loop: number,
  overall: ArtifactOverall,
): ValidationArtifact {
  return {
    id: `art_${loop}`,
    taskId: task.id,
    runId: 'run_test',
    workspaceRef: '/tmp/ws',
    loop,
    checks: [
      {
        kind: 'diff',
        status: 'pass',
        outputExcerpt: 'diff --git a/x b/x\n+new',
        durationMs: 1,
        evidence: 'config',
        required: true,
      },
      ...(overall === 'fail'
        ? [
            {
              kind: 'tests' as const,
              command: 'vitest',
              status: 'fail' as const,
              exitCode: 1,
              outputExcerpt: 'AssertionError',
              durationMs: 2,
              evidence: 'test' as const,
              required: true,
            },
          ]
        : []),
    ],
    overall,
    diffStat: { files: 1, insertions: 1, deletions: 0 },
    createdAt: '2026-09-11T00:00:00Z',
  };
}

/** 脚本化 runner：按调用序出队 overall 序列（耗尽重复末项） */
function fakeRunner(overalls: ArtifactOverall[]) {
  const queue = [...overalls];
  const calls: number[] = [];
  const runner: Validator = {
    validate: async (input) => {
      calls.push(input.loop);
      const overall = queue.length > 1 ? queue.shift()! : (queue[0] ?? 'pass');
      return artifactOf(input.loop, overall);
    },
  };
  return { runner, loops: calls };
}

/** 脚本化 reviewer：verdict 序列 / 注定失败 */
function fakeReviewer(
  verdicts: Array<'approved' | 'changes_requested' | 'ERROR'>,
) {
  const queue = [...verdicts];
  const requests: string[] = [];
  const reviewer: Reviewer = {
    review: async (request) => {
      requests.push(`${request.loop}:${request.priorFeedback ?? '-'}`);
      const next = queue.length > 1 ? queue.shift()! : (queue[0] ?? 'approved');
      if (next === 'ERROR') {
        const outcome: ReviewOutcome = {
          ok: false,
          code: 'verdict_unparseable',
          detail: '输出不可解析',
        };
        return outcome;
      }
      return {
        ok: true,
        verdict: {
          verdict: next,
          comments: `意见-${requests.length}`,
          loop: request.loop,
        },
      };
    },
  };
  return { reviewer, requests };
}

function evaluationWith(fixResults: Array<{ ok: boolean; detail?: string }>) {
  const fixes = [...fixResults];
  const feedbacks: string[] = [];
  const evaluation: GateEvaluation = {
    task,
    workspace: {
      taskId: task.id,
      runId: 'run_test',
      path: '/tmp/ws',
      branch: 'fleet/x/impl-a',
      baseline: 'abc',
      status: 'active',
    },
    execution: { ok: true },
    reexecute: async (feedback: string) => {
      feedbacks.push(feedback);
      return fixes.length > 1 ? fixes.shift()! : (fixes[0] ?? { ok: true });
    },
  };
  return { evaluation, feedbacks };
}

function gateOf(
  runner: Validator,
  reviewer: Reviewer,
  options: { maxReviewLoops?: number; events?: ValidationEvent[] } = {},
) {
  const events: ValidationEvent[] = [];
  const gate = new ValidationReviewGate({
    runner,
    reviewer,
    mission,
    runId: 'run_test',
    profile: {
      checks: {
        lint: { required: false },
        typecheck: { required: false },
        tests: { required: false },
      },
      timeoutMs: 1000,
      maxReviewLoops: options.maxReviewLoops ?? 2,
    },
    emitEvent: (event) => {
      events.push(event);
      options.events?.push(event);
    },
  });
  return { gate, events };
}

describe('ValidationReviewGate（SC-003 三路径 + 不变式）', () => {
  it('一次通过：验证 pass + 审阅 approved（0 修复，rounds=0）', async () => {
    const { runner } = fakeRunner(['pass']);
    const { reviewer, requests } = fakeReviewer(['approved']);
    const { gate, events } = gateOf(runner, reviewer);
    const { evaluation } = evaluationWith([{ ok: true }]);

    const decision = await gate.evaluate(evaluation);
    expect(decision).toEqual({
      pass: true,
      outcome: 'approved',
      detail: '验证通过 + 审阅批准（零修复）',
    });
    expect(requests).toHaveLength(1);
    expect(gate.packages).toHaveLength(1);
    expect(gate.packages[0]).toMatchObject({ terminal: 'approved', rounds: 0 });
    expect(gate.packages[0]!.verdicts).toHaveLength(1);
    const types = events
      .map((event) => event.type)
      .filter((type) => type.startsWith('task.'));
    expect(types).toEqual([
      'task.validation.started',
      'task.validation.completed',
      'task.review.started',
      'task.review.completed',
    ]);
    // M11 roadmap 别名并行发射
    expect(events.map((event) => event.type)).toContain('review.approved');
  });

  it('一轮修复后通过：验证 fail → 修复 → 验证 pass → 审阅 approved（rounds=1）', async () => {
    const { runner, loops } = fakeRunner(['fail', 'pass']);
    const { reviewer } = fakeReviewer(['approved']);
    const { gate } = gateOf(runner, reviewer);
    const { evaluation, feedbacks } = evaluationWith([{ ok: true }]);

    const decision = await gate.evaluate(evaluation);
    expect(decision.pass).toBe(true);
    expect(gate.packages[0]).toMatchObject({ terminal: 'approved', rounds: 1 });
    expect(gate.packages[0]!.artifacts).toHaveLength(2); // 全轮次
    expect(loops).toEqual([0, 1]); // loop 序号 +1 可追溯
    expect(feedbacks[0]).toContain('验证未通过'); // 修复上下文 = 验证失败摘要
  });

  it('审阅退回路径：CR → 修复 → CR → 修复 → CR → review_exceeded（无第 3 轮修复）', async () => {
    const { runner } = fakeRunner(['pass']);
    const { reviewer, requests } = fakeReviewer(['changes_requested']);
    const { gate, events } = gateOf(runner, reviewer, { maxReviewLoops: 2 });
    const { evaluation, feedbacks } = evaluationWith([{ ok: true }]);

    const decision = await gate.evaluate(evaluation);
    expect(decision.pass).toBe(false);
    expect(decision.outcome).toBe('review_exceeded');
    expect(decision.retryable).toBe(false);
    expect(decision.detail).toContain('2/2');
    expect(feedbacks).toHaveLength(2); // 恰 2 轮修复——上限强制
    expect(requests).toHaveLength(3); // 审阅 = 修复 + 1（每轮修复必被评价）
    expect(gate.packages[0]).toMatchObject({
      terminal: 'review_exceeded',
      rounds: 2,
      maxReviewLoops: 2,
    });
    expect(gate.packages[0]!.verdicts).toHaveLength(3);
    expect(gate.packages[0]!.artifacts).toHaveLength(3);
    expect(
      events.filter((event) => event.type === 'task.review.exceeded'),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.type === 'review.exceeded'),
    ).toHaveLength(1);
  });

  it('审阅错误 → fail-closed：review_error 直达，不进修复循环', async () => {
    const { runner } = fakeRunner(['pass']);
    const { reviewer } = fakeReviewer(['ERROR']);
    const { gate } = gateOf(runner, reviewer);
    const { evaluation, feedbacks } = evaluationWith([{ ok: true }]);

    const decision = await gate.evaluate(evaluation);
    expect(decision.pass).toBe(false);
    expect(decision.outcome).toBe('review_error');
    expect(decision.retryable).toBe(false);
    expect(decision.detail).toContain('verdict_unparseable');
    expect(feedbacks).toHaveLength(0); // 审阅者缺席不消耗轮次
    expect(gate.packages[0]).toMatchObject({
      terminal: 'review_error',
      rounds: 0,
    });
  });

  it('修复执行失败 → fix_failed（缺省可重试，M5 语义）', async () => {
    const { runner } = fakeRunner(['fail']);
    const { reviewer, requests } = fakeReviewer(['approved']);
    const { gate } = gateOf(runner, reviewer);
    const { evaluation } = evaluationWith([
      { ok: false, detail: '替身修复失败' },
    ]);

    const decision = await gate.evaluate(evaluation);
    expect(decision.pass).toBe(false);
    expect(decision.outcome).toBe('fix_failed');
    expect(decision.retryable).toBeUndefined();
    expect(decision.detail).toContain('替身修复失败');
    expect(requests).toHaveLength(0);
  });

  it('首跑实现失败 → fix_failed 直达（不 validate，M5 语义）', async () => {
    const { runner, loops } = fakeRunner(['pass']);
    const { reviewer } = fakeReviewer(['approved']);
    const { gate } = gateOf(runner, reviewer);
    const evaluation: GateEvaluation = {
      task,
      workspace: evaluationWith([]).evaluation.workspace,
      execution: { ok: false, detail: 'impl 崩溃' },
      reexecute: async () => ({ ok: true }),
    };
    const decision = await gate.evaluate(evaluation);
    expect(decision).toMatchObject({
      pass: false,
      outcome: 'fix_failed',
      detail: 'impl 崩溃',
    });
    expect(loops).toHaveLength(0);
    expect(gate.packages).toHaveLength(0);
  });

  it('maxReviewLoops=0 纯验证门：pass 即验收（零审阅）；fail 即 review_exceeded', async () => {
    const pass = fakeRunner(['pass']);
    const okReviewer = fakeReviewer(['approved']);
    const pureGate = gateOf(pass.runner, okReviewer.reviewer, {
      maxReviewLoops: 0,
    });
    const okDecision = await pureGate.gate.evaluate(
      evaluationWith([]).evaluation,
    );
    expect(okDecision).toMatchObject({ pass: true, outcome: 'approved' });
    expect(okReviewer.requests).toHaveLength(0); // 纯验证门不执行审阅

    const bad = fakeRunner(['fail']);
    const badReviewer = fakeReviewer(['approved']);
    const failGate = gateOf(bad.runner, badReviewer.reviewer, {
      maxReviewLoops: 0,
    });
    const failDecision = await failGate.gate.evaluate(
      evaluationWith([]).evaluation,
    );
    expect(failDecision).toMatchObject({
      pass: false,
      outcome: 'review_exceeded',
      retryable: false,
    });
    expect(badReviewer.requests).toHaveLength(0);
  });

  it('事件完备可重放：验证/审阅各含 loop 与结论（SC-005 库级）', async () => {
    const { runner } = fakeRunner(['fail', 'pass']);
    const { reviewer } = fakeReviewer(['changes_requested', 'approved']);
    const { gate, events } = gateOf(runner, reviewer, { maxReviewLoops: 2 });
    await gate.evaluate(evaluationWith([{ ok: true }]).evaluation);

    const validations = events.filter((event) =>
      event.type.startsWith('task.validation.'),
    );
    // loop0 验证 fail → 修复 → loop1 pass → CR → 修复 → loop2 pass → approved
    expect(
      validations.map((event) => ('loop' in event ? event.loop : -1)),
    ).toEqual([0, 0, 1, 1, 2, 2]);
    const reviews = events.filter((event) =>
      event.type.startsWith('task.review.'),
    );
    expect(reviews).toHaveLength(4); // started/completed × 2（验证 fail 轮不审阅）
    const completed = events.filter(
      (event) => event.type === 'task.review.completed',
    );
    expect(
      completed.map((event) => ('verdict' in event ? event.verdict : '')),
    ).toEqual(['changes_requested', 'approved']);
    // 每条事件可 JSON 序列化 round-trip（重放原料）
    for (const event of events) {
      expect(JSON.parse(JSON.stringify(event))).toEqual(event);
    }
  });
});
