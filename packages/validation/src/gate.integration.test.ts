import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeRuntimeAdapter } from '@fleet/runtime';
import { AgentTaskExecutor } from '@fleet/agents';
import { RuntimeRegistry } from '@fleet/agents';
import { buildDag, Scheduler } from '@fleet/scheduler';
import { loadMission } from '@fleet/mission';
import {
  GitWorktreeManager,
  WorkspaceResolvingExecutor,
} from '@fleet/workspace';

import { ValidationReviewGate } from './gate.js';
import { ValidationRunner } from './runner.js';
import { AgentReviewer } from './review.js';

/**
 * T011 真管理器集成（research.md D9）：tmp git 仓库 + 真
 * GitWorktreeManager + 双 Fake（实现者 touchOnSuccess 写 worktree /
 * 审阅者脚本化裁决——分离避免越权写）+ Scheduler 全链。
 * approved → merged；连续 reject → review_exceeded + 零 merge +
 * attempts=1（retryable=false 生效）。
 */

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'fleet-test',
  GIT_AUTHOR_EMAIL: 'test@fleet.local',
  GIT_COMMITTER_NAME: 'fleet-test',
  GIT_COMMITTER_EMAIL: 'test@fleet.local',
};

let repo: string;

function git(cmd: string): string {
  return execSync(`git ${cmd}`, {
    cwd: repo,
    env: { ...process.env, ...GIT_ENV },
  }).toString();
}

beforeAll(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'fleet-gate-'));
  git('init -q -b main');
  writeFileSync(path.join(repo, '.gitignore'), '.fleet/\n');
  writeFileSync(path.join(repo, 'base.txt'), 'baseline\n');
  git('add -A');
  git('commit -qm baseline');
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

function assemble(
  reviewScript: Record<string, Array<{ outcome: 'success'; output: string }>>,
  maxReviewLoops = 2,
) {
  const manager = new GitWorktreeManager(repo, { git: { env: GIT_ENV } });
  const implFake = new FakeRuntimeAdapter({
    zeroDelays: true,
    touchOnSuccess: ['out.txt'],
  });
  const reviewFake = new FakeRuntimeAdapter({
    zeroDelays: true,
    script: reviewScript,
  });
  const registry = new RuntimeRegistry(implFake);
  const wrapperRef: { current?: WorkspaceResolvingExecutor } = {};
  const profile = {
    checks: {
      lint: { required: false },
      typecheck: { required: false },
      tests: { required: false },
    },
    timeoutMs: 2000,
    maxReviewLoops,
  };
  const runner = new ValidationRunner({ manager, profile });
  const gate = new ValidationReviewGate({
    runner,
    reviewer: new AgentReviewer({ adapter: reviewFake, repoRoot: repo }),
    mission: integrationMission,
    runId: 'run_gateit01',
    profile,
  });
  const wrapper = new WorkspaceResolvingExecutor({
    inner: new AgentTaskExecutor({
      registry,
      cwd: (task) => wrapperRef.current!.cwdResolver(task),
    }),
    manager,
    repoRoot: repo,
    runId: 'run_gateit01',
    gate,
  });
  wrapperRef.current = wrapper;
  return { wrapper, gate, implFake, reviewFake };
}

const REVIEW_APPROVED = JSON.stringify({
  verdict: 'approved',
  comments: '通过',
});
const REVIEW_REJECT = JSON.stringify({
  verdict: 'changes_requested',
  comments: '请补充',
});

const integrationMission = loadMission(
  `
id: gateit10
goal: 集成验证目标
planningMode: execution
requirements:
  - text: 需求
plan:
  summary: 方案
tasks:
  - id: placeholder
    goal: 占位
    agentRole: reason
acceptance:
  - given: 无
    when: 执行
    then: 完成
`,
  { sourcePath: '<test>' },
);

describe('ValidationReviewGate 真管理器集成', () => {
  it('approved → merged：主分支含写入文件；worktree 清理', async () => {
    const { wrapper, gate } = assemble({
      'ok-task-review': [{ outcome: 'success', output: REVIEW_APPROVED }],
    });
    const outcome = await new Scheduler().run(
      buildDag([
        { id: 'ok-task', goal: '实现', agentRole: 'reason', dependsOn: [] },
      ]),
      wrapper,
    );
    expect(outcome.status).toBe('completed');
    expect(existsSync(path.join(repo, 'out.txt'))).toBe(true); // merged 后主分支可见
    expect(gate.packages[0]).toMatchObject({ terminal: 'approved', rounds: 0 });
    expect(wrapper.dispositions[0]).toMatchObject({
      action: 'merged',
      outcome: 'approved',
    });
    expect(git('status --porcelain').trim()).toBe('');
  });

  it('连续 reject（maxReviewLoops=2）→ review_exceeded：零 merge + attempts=1（不重试）', async () => {
    const { wrapper, gate } = assemble({
      'bad-task-review': [{ outcome: 'success', output: REVIEW_REJECT }],
    });
    const outcome = await new Scheduler().run(
      buildDag([
        { id: 'bad-task', goal: '实现', agentRole: 'reason', dependsOn: [] },
      ]),
      wrapper,
    );
    expect(outcome.status).toBe('failed');
    const node = outcome.nodes.find((entry) => entry.taskId === 'bad-task')!;
    expect(node.status).toBe('failed');
    expect(node.attempts).toBe(1); // retryable=false：确定性结论不重试
    expect(node.failureReason).toContain('review_exceeded');
    expect(gate.packages[0]).toMatchObject({
      terminal: 'review_exceeded',
      rounds: 2,
    });
    expect(gate.packages[0]!.verdicts).toHaveLength(3); // 修复 + 1 轮全被评价
    expect(git('log --oneline --grep=bad-task')).toBe(''); // 零合并
    expect(wrapper.dispositions[0]).toMatchObject({
      action: 'destroyed',
      outcome: 'review_exceeded',
    });
    expect(git('status --porcelain').trim()).toBe('');
  });

  it('一轮修复后通过：CR → 修复（touchOnSuccess 追加写）→ approved（rounds=1）', async () => {
    const { wrapper, gate } = assemble({
      'fix-task-review': [
        { outcome: 'success', output: REVIEW_REJECT },
        { outcome: 'success', output: REVIEW_APPROVED },
      ],
    });
    const outcome = await new Scheduler().run(
      buildDag([
        { id: 'fix-task', goal: '实现', agentRole: 'reason', dependsOn: [] },
      ]),
      wrapper,
    );
    expect(outcome.status).toBe('completed');
    expect(gate.packages[0]).toMatchObject({ terminal: 'approved', rounds: 1 });
    expect(gate.packages[0]!.artifacts).toHaveLength(2);
    expect(existsSync(path.join(repo, 'out.txt'))).toBe(true);
  });

  it('审阅输出乱码 → review_error：fail-closed，任务失败零合并', async () => {
    const { wrapper, gate } = assemble({
      'err-task-review': [{ outcome: 'success', output: '看着不错，合了吧' }],
    });
    const outcome = await new Scheduler().run(
      buildDag([
        { id: 'err-task', goal: '实现', agentRole: 'reason', dependsOn: [] },
      ]),
      wrapper,
    );
    expect(outcome.status).toBe('failed');
    const node = outcome.nodes.find((entry) => entry.taskId === 'err-task')!;
    expect(node.failureReason).toContain('review_error');
    expect(node.attempts).toBe(1);
    expect(gate.packages[0]).toMatchObject({ terminal: 'review_error' });
    expect(git('log --oneline --grep=err-task')).toBe('');
  });
});
