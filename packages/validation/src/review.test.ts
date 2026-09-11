import { describe, expect, it } from 'vitest';
import { loadMission } from '@fleet/mission';
import { FakeRuntimeAdapter } from '@fleet/runtime';

import { AgentReviewer } from './review.js';
import { parseVerdict } from './review.js';
import type { ReviewRequest } from './types.js';

/** T009：裁决解析两级宽容 / 非法拒绝 / 适配器失败 fail-closed / 请求契约 */

const reviewMission = loadMission(
  `
id: rv10
goal: 交付功能 X
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

function requestOf(): ReviewRequest {
  return {
    mission: reviewMission,
    taskId: 'impl-a',
    loop: 1,
    artifact: {
      id: 'art_test',
      taskId: 'impl-a',
      runId: 'run_1',
      workspaceRef: '/tmp/ws',
      loop: 1,
      checks: [
        {
          kind: 'diff',
          status: 'pass',
          outputExcerpt: '',
          durationMs: 1,
          evidence: 'config',
          required: true,
        },
        {
          kind: 'tests',
          status: 'fail',
          exitCode: 1,
          outputExcerpt: 'AssertionError: expected 1 to be 2',
          durationMs: 5,
          evidence: 'test',
          required: true,
        },
      ],
      overall: 'fail',
      diffStat: { files: 2, insertions: 10, deletions: 3 },
      createdAt: '2026-09-11T00:00:00Z',
    },
    diffExcerpt: 'diff --git a/x b/x\n+hello',
    priorFeedback: '上一轮意见：请补测试',
  };
}

function reviewerWith(fake: FakeRuntimeAdapter): AgentReviewer {
  return new AgentReviewer({
    adapter: fake,
    repoRoot: '/repo',
    timeoutMs: 2000,
  });
}

describe('AgentReviewer（裁决执行与解析）', () => {
  it('JSON 裁决解析成功（含前后噪声宽容）', async () => {
    const fake = new FakeRuntimeAdapter({
      script: {
        'impl-a-review': [
          {
            outcome: 'success',
            output:
              '思考中…\n{"verdict":"changes_requested","comments":"请修复"}\ndone',
          },
        ],
      },
    });
    const outcome = await reviewerWith(fake).review(requestOf());
    expect(outcome).toMatchObject({
      ok: true,
      verdict: { verdict: 'changes_requested', comments: '请修复', loop: 1 },
    });
  });

  it('裸词裁决匹配（approved）', async () => {
    const fake = new FakeRuntimeAdapter({
      script: { 'impl-a-review': [{ outcome: 'success', output: 'approved' }] },
    });
    const outcome = await reviewerWith(fake).review(requestOf());
    expect(outcome).toMatchObject({
      ok: true,
      verdict: { verdict: 'approved' },
    });
  });

  it('输出不可解析 → verdict_unparseable（fail-closed）', async () => {
    const fake = new FakeRuntimeAdapter({
      script: {
        'impl-a-review': [
          { outcome: 'success', output: '看起来不错，可以合了' },
        ],
      },
    });
    const outcome = await reviewerWith(fake).review(requestOf());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe('verdict_unparseable');
    }
  });

  it('适配器失败 → fail-closed（错误直达，不放行）', async () => {
    const fake = new FakeRuntimeAdapter({
      script: { 'impl-a-review': [{ outcome: 'failure' }] },
    });
    const outcome = await reviewerWith(fake).review(requestOf());
    expect(outcome.ok).toBe(false);
  });

  it('请求契约：wisdom 角色 + READ_ONLY + cwd=主仓根 + agentId 约定', async () => {
    const fake = new FakeRuntimeAdapter({
      script: { 'impl-a-review': [{ outcome: 'success', output: 'approved' }] },
    });
    await reviewerWith(fake).review(requestOf());
    const request = fake.requests[0]!;
    expect(request.agentId).toBe('agent:impl-a-review');
    expect(request.cwd).toBe('/repo');
    expect(request.env?.FLEET_AGENT_ROLE).toBe('wisdom');
    expect(request.env?.FLEET_PERMISSION).toBe('READ_ONLY');
    expect(request.prompt).toContain('changes_requested'); // 输出格式说明
    expect(request.prompt).toContain('上一轮意见'); // priorFeedback 透传
    expect(request.prompt).toContain('## mission'); // M10 统一装配分节
    expect(request.prompt).toContain('交付功能 X'); // mission 内容注入
    expect(request.prompt).toContain('AssertionError'); // 失败检查摘要
  });
});

describe('parseVerdict（单元矩阵）', () => {
  it('合法枚举 / 前后空白 / 引号包裹', () => {
    expect(parseVerdict('  approved  ')).toEqual({
      verdict: 'approved',
      comments: '',
    });
    expect(parseVerdict('"changes_requested"')).toEqual({
      verdict: 'changes_requested',
      comments: '',
    });
  });

  it('非法：空 / 未知词 / 非法 JSON verdict', () => {
    expect(parseVerdict('')).toBeUndefined();
    expect(parseVerdict('maybe')).toBeUndefined();
    expect(parseVerdict('{"verdict":"maybe"}')).toBeUndefined();
    expect(parseVerdict('{"verdict": 42}')).toBeUndefined();
  });

  it('JSON comments 缺省为空串（宽容）', () => {
    expect(parseVerdict('{"verdict":"approved"}')).toEqual({
      verdict: 'approved',
      comments: '',
    });
  });
});
