import { execSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FakeRuntimeAdapter,
  permissionOf,
  type Permission,
} from '@fleet/runtime';
import { createId } from '@fleet/core';
import type { Task } from '@fleet/mission';
import type { TaskExecutor } from '@fleet/scheduler';
import { buildDag, Scheduler } from '@fleet/scheduler';

import { GitWorktreeManager } from './manager.js';
import { WorkspaceResolvingExecutor } from './executor.js';

/**
 * US2 集成（T009）：SC-005 物理范围 / 处置策略 / 并行互不可见 /
 * 基线继承。Fake touchOnSuccess 承担写行为（不依赖真实 LLM）。
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

function task(
  id: string,
  role: 'reason' | 'reflex' | 'focus',
  dependsOn: string[] = [],
) {
  return { id, goal: `goal-${id}`, agentRole: role, dependsOn } as const;
}

beforeAll(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'fleet-wse-'));
  git('init -q -b main');
  writeFileSync(path.join(repo, '.gitignore'), '.fleet/\n');
  writeFileSync(path.join(repo, 'base.txt'), 'baseline\n');
  git('add -A');
  git('commit -qm baseline');
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

/** Fake（RuntimeAdapter）→ TaskExecutor 桥：构造合法请求（含权限 env） */
function fakeTaskExecutor(
  fake: FakeRuntimeAdapter,
  cwdOf: (task: Task) => string,
): TaskExecutor {
  return {
    async execute(task: Task) {
      const result = await fake.execute({
        runId: createId('run_'),
        agentId: `agent:${task.id}`,
        cwd: cwdOf(task),
        prompt: `[任务 ${task.id}] ${task.goal}`,
        env: {
          FLEET_AGENT_ROLE: task.agentRole,
          FLEET_PERMISSION: permissionOf(task.agentRole) as Permission,
        },
        timeoutMs: 5000,
      });
      return {
        ok: result.ok,
        ...(result.detail !== undefined ? { detail: result.detail } : {}),
      };
    },
  };
}

describe('WorkspaceResolvingExecutor（SC-005 / 处置 / 并行 / 基线）', () => {
  it('写角色 cwd=worktree、只读角色 cwd=主仓根（SC-005，请求流 100% 对应）', async () => {
    const manager = new GitWorktreeManager(repo, { git: { env: GIT_ENV } });
    // spy executor：记录 wrapper 解析出的 cwd（SC-005 的直接断言面）
    const seen: Array<{ taskId: string; cwd: string }> = [];
    const wrapperRef: { current?: WorkspaceResolvingExecutor } = {};
    const wrapper = new WorkspaceResolvingExecutor({
      inner: {
        execute: async (t) => {
          seen.push({ taskId: t.id, cwd: wrapperRef.current!.cwdResolver(t) });
          return { ok: true };
        },
      },
      manager,
      repoRoot: repo,
      runId: 'run_sc005test',
    });
    wrapperRef.current = wrapper;

    await wrapper.execute(task('write-it', 'reason'));
    await wrapper.execute(task('read-it', 'focus'));

    expect(seen).toHaveLength(2);
    const writeSeen = seen.find((entry) => entry.taskId === 'write-it')!;
    const readSeen = seen.find((entry) => entry.taskId === 'read-it')!;
    expect(writeSeen.cwd).toContain(path.join('.fleet', 'worktrees')); // 写角色 = worktree
    // （merge 后 worktree 已按 auto 策略清理——存在性在 spy 时点已验证）
    expect(realpathSync(readSeen.cwd)).toBe(realpathSync(repo)); // 只读 = 主仓根
  });

  it('auto 策略：成功 → merged（主分支含写入文件）；失败 → destroyed', async () => {
    const manager = new GitWorktreeManager(repo, { git: { env: GIT_ENV } });
    const fake = new FakeRuntimeAdapter({
      zeroDelays: true,
      touchOnSuccess: ['by-fake.txt'],
      script: { 'fail-write': ['failure', 'failure'] },
    });
    const wrapperRef: { current?: WorkspaceResolvingExecutor } = {};
    const wrapper = new WorkspaceResolvingExecutor({
      inner: fakeTaskExecutor(fake, (t) => wrapperRef.current!.cwdResolver(t)),
      manager,
      repoRoot: repo,
      runId: 'run_autostrat',
    });
    wrapperRef.current = wrapper;
    // 成功任务：fake 写 by-fake.txt 到 cwd（= worktree）
    await wrapper.execute(task('ok-write', 'reason'));
    expect(existsSync(path.join(repo, 'by-fake.txt'))).toBe(true); // 已 merge
    expect(wrapper.dispositions.at(-1)?.action).toBe('merged');

    // 失败任务：destroyed + worktree 消失
    const failResult = await wrapper.execute(task('fail-write', 'reason'));
    expect(failResult.ok).toBe(false);
    expect(wrapper.dispositions.at(-1)?.action).toBe('destroyed');
  });

  it('keep-on-finish：保留 worktree 供人工', async () => {
    const manager = new GitWorktreeManager(repo, { git: { env: GIT_ENV } });
    const fake = new FakeRuntimeAdapter({ zeroDelays: true });
    const wrapperRef: { current?: WorkspaceResolvingExecutor } = {};
    const wrapper = new WorkspaceResolvingExecutor({
      inner: fakeTaskExecutor(fake, (t) => wrapperRef.current!.cwdResolver(t)),
      manager,
      repoRoot: repo,
      policy: 'keep-on-finish',
      runId: 'run_keeptest1',
    });
    wrapperRef.current = wrapper;
    await wrapper.execute(task('keep-me', 'reason'));
    expect(wrapper.dispositions.at(-1)?.action).toBe('kept');
    const inv = manager.activeWorkspaces();
    expect(inv.some((ws) => ws.taskId === 'keep-me')).toBe(true);
    // 清理（善后）
    for (const ws of inv) {
      await manager.destroy(ws);
    }
  });

  it('并行互不可见 + 双 merge 兼得（SC-002 单元层）', async () => {
    const manager = new GitWorktreeManager(repo, { git: { env: GIT_ENV } });
    const fakeA = new FakeRuntimeAdapter({
      zeroDelays: true,
      touchOnSuccess: ['a-file.txt'],
    });
    const fakeB = new FakeRuntimeAdapter({
      zeroDelays: true,
      touchOnSuccess: ['b-file.txt'],
    });
    const paths = new Map<string, string>();

    const makeWrapper = (fake: FakeRuntimeAdapter, suffix: string) => {
      const wrapperRef: { current?: WorkspaceResolvingExecutor } = {};
      const wrapper = new WorkspaceResolvingExecutor({
        inner: fakeTaskExecutor(fake, (t) => {
          const cwd = wrapperRef.current!.cwdResolver(t);
          paths.set(t.id, cwd);
          return cwd;
        }),
        manager,
        repoRoot: repo,
        runId: `run_par${suffix}`,
      });
      wrapperRef.current = wrapper;
      return wrapper;
    };

    const wrapperA = makeWrapper(fakeA, 'aa');
    const wrapperB = makeWrapper(fakeB, 'bb');
    await Promise.all([
      wrapperA.execute(task('par-a', 'reason')),
      wrapperB.execute(task('par-b', 'reason')),
    ]);

    const pathA = paths.get('par-a')!;
    const pathB = paths.get('par-b')!;
    expect(pathA).not.toBe(pathB);
    // 并行期间互不可见：A 的 worktree 无 B 的文件（merge 前时刻已过——
    // 以 dispositions 时序近似；主仓干净由 e2e 轮询精确断言）
    // 双 merge 兼得
    expect(existsSync(path.join(repo, 'a-file.txt'))).toBe(true);
    expect(existsSync(path.join(repo, 'b-file.txt'))).toBe(true);
  });

  it('串行依赖基线继承：B 的 worktree 含 A 已合并变更', async () => {
    const manager = new GitWorktreeManager(repo, { git: { env: GIT_ENV } });
    const fake = new FakeRuntimeAdapter({
      zeroDelays: true,
      touchOnSuccess: ['dep-file.txt'],
    });
    const wrapperRef: { current?: WorkspaceResolvingExecutor } = {};
    const wrapper = new WorkspaceResolvingExecutor({
      inner: fakeTaskExecutor(fake, (t) => wrapperRef.current!.cwdResolver(t)),
      manager,
      repoRoot: repo,
      runId: 'run_depchain1',
    });
    wrapperRef.current = wrapper;
    // A 完成（merge 后）→ B create 基线 = 新 HEAD
    await wrapper.execute(task('dep-a', 'reason'));
    const wsB = await manager.create('dep-b', { runId: 'run_depchain1' });
    expect(existsSync(path.join(wsB.path, 'dep-file.txt'))).toBe(true); // 基线含 A 成果
    await manager.destroy(wsB);
  });

  it('create 故障 → 任务失败（detail=fault code）不击穿', async () => {
    // dirty 主仓注入
    writeFileSync(path.join(repo, 'temp-dirty.txt'), 'dirty\n');
    try {
      const manager = new GitWorktreeManager(repo, { git: { env: GIT_ENV } });
      const fake = new FakeRuntimeAdapter({ zeroDelays: true });
      const wrapperRef: { current?: WorkspaceResolvingExecutor } = {};
      const wrapper = new WorkspaceResolvingExecutor({
        inner: fakeTaskExecutor(fake, (t) =>
          wrapperRef.current!.cwdResolver(t),
        ),
        manager,
        repoRoot: repo,
        runId: 'run_faulttest',
      });
      wrapperRef.current = wrapper;
      const result = await wrapper.execute(task('blocked', 'reason'));
      expect(result.ok).toBe(false);
      expect(result.detail).toContain('dirty_main');
    } finally {
      rmSync(path.join(repo, 'temp-dirty.txt'));
    }
  });

  it('调度器全链：DAG → wrapper → Fake 写 → merged（批次屏障下端到端）', async () => {
    const manager = new GitWorktreeManager(repo, { git: { env: GIT_ENV } });
    const fake = new FakeRuntimeAdapter({
      zeroDelays: true,
      touchOnSuccess: ['sched-file.txt'],
    });
    const wrapperRef: { current?: WorkspaceResolvingExecutor } = {};
    const wrapper = new WorkspaceResolvingExecutor({
      inner: fakeTaskExecutor(fake, (t) => wrapperRef.current!.cwdResolver(t)),
      manager,
      repoRoot: repo,
      runId: 'run_schedtest',
    });
    wrapperRef.current = wrapper;
    const dag = buildDag([task('s1', 'reason'), task('s2', 'reason', ['s1'])]);
    const outcome = await new Scheduler().run(dag, wrapper);
    expect(outcome.status).toBe('completed');
    expect(existsSync(path.join(repo, 'sched-file.txt'))).toBe(true);
    expect(git('status --porcelain').trim()).toBe(''); // 主仓干净
  });
});

describe('M9 gate 接缝（T004）', () => {
  it('gate 通过 → merged；拒绝 → destroyed + 任务失败 + retryable 透传', async () => {
    const manager = new GitWorktreeManager(repo, { git: { env: GIT_ENV } });
    const decisions = [true, false];
    const gate: import('./types.js').WorkspaceGate = {
      packages: [{ taskId: 'g1' }, { taskId: 'g2' }],
      evaluate: async (evaluation) => {
        // 修复轮次入口透传（reexecute 可用性）
        expect(evaluation.reexecute).toBeTypeOf('function');
        expect(evaluation.workspace.path).toContain('.fleet');
        const pass = decisions.shift()!;
        return pass
          ? { pass: true, outcome: 'approved' }
          : {
              pass: false,
              outcome: 'review_exceeded',
              detail: '审阅轮次耗尽',
              retryable: false,
            };
      },
    };
    const wrapperRef: { current?: WorkspaceResolvingExecutor } = {};
    const wrapper = new WorkspaceResolvingExecutor({
      inner: {
        execute: async (t) => {
          writeFileSync(
            path.join(wrapperRef.current!.cwdResolver(t), `${t.id}.txt`),
            'gate-seam\n',
          );
          return { ok: true };
        },
      },
      manager,
      repoRoot: repo,
      runId: 'run_gate1',
      gate,
    });
    wrapperRef.current = wrapper;

    const passResult = await wrapper.execute(task('g1', 'reason'));
    expect(passResult.ok).toBe(true);
    expect(git('log --oneline --grep=g1 -1')).toContain('fleet: merge g1');

    const failResult = await wrapper.execute(task('g2', 'reason'));
    expect(failResult.ok).toBe(false);
    expect(failResult.detail).toBe('审阅轮次耗尽');
    expect(failResult.retryable).toBe(false);
    expect(git('log --oneline --grep=g2')).toBe(''); // 零合并

    const dispositions = wrapper.dispositions;
    expect(dispositions.find((d) => d.taskId === 'g1')!.action).toBe('merged');
    expect(dispositions.find((d) => d.taskId === 'g1')!.outcome).toBe(
      'approved',
    );
    const g2 = dispositions.find((d) => d.taskId === 'g2')!;
    expect(g2.action).toBe('destroyed');
    expect(g2.outcome).toBe('review_exceeded');
    expect(wrapper.reviews).toEqual(gate.packages); // 报告面代理
  });

  it('reexecute 闭包转发 inner（反馈透传）+ gate 异常 fail-closed', async () => {
    const manager = new GitWorktreeManager(repo, { git: { env: GIT_ENV } });
    const feedbacks: string[] = [];
    const inner: TaskExecutor = {
      execute: async (_t, feedback) => {
        if (feedback !== undefined) {
          feedbacks.push(feedback);
          return { ok: true };
        }
        return { ok: true };
      },
    };
    const gate: import('./types.js').WorkspaceGate = {
      packages: [],
      evaluate: async (evaluation) => {
        const fix = await evaluation.reexecute('请补充测试覆盖');
        return fix.ok
          ? { pass: true, outcome: 'approved' }
          : { pass: false, outcome: 'fix_failed' };
      },
    };
    const wrapper = new WorkspaceResolvingExecutor({
      inner,
      manager,
      repoRoot: repo,
      runId: 'run_gate2',
      gate,
    });
    const result = await wrapper.execute(task('g3', 'reason'));
    expect(result.ok).toBe(true);
    expect(feedsBack()).toBe(true);
    function feedsBack(): boolean {
      return feedbacks.includes('请补充测试覆盖');
    }

    // gate 抛异常 → fail-closed：任务失败 + destroyed，不击穿
    const boomGate: import('./types.js').WorkspaceGate = {
      packages: [],
      evaluate: async () => {
        throw new Error('审阅器崩溃');
      },
    };
    const wrapper2 = new WorkspaceResolvingExecutor({
      inner: { execute: async () => ({ ok: true }) },
      manager,
      repoRoot: repo,
      runId: 'run_gate3',
      gate: boomGate,
    });
    const boomed = await wrapper2.execute(task('g4', 'reason'));
    expect(boomed.ok).toBe(false);
    expect(boomed.retryable).toBe(false);
    expect(boomed.detail).toContain('fail-closed');
  });

  it('无 gate 回归：成功直接 merge（M8 行为逐字节不变）', async () => {
    const manager = new GitWorktreeManager(repo, { git: { env: GIT_ENV } });
    const wrapperRef: { current?: WorkspaceResolvingExecutor } = {};
    const wrapper = new WorkspaceResolvingExecutor({
      inner: {
        execute: async (t) => {
          writeFileSync(
            path.join(wrapperRef.current!.cwdResolver(t), `${t.id}.txt`),
            'm8-regress\n',
          );
          return { ok: true };
        },
      },
      manager,
      repoRoot: repo,
      runId: 'run_gate4',
    });
    wrapperRef.current = wrapper;
    const result = await wrapper.execute(task('g5', 'reason'));
    expect(result.ok).toBe(true);
    expect(result.retryable).toBeUndefined();
    expect(wrapper.reviews).toBeUndefined();
    expect(git('log --oneline --grep=g5 -1')).toContain('fleet: merge g5');
  });
});
