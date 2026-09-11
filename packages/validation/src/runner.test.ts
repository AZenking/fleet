import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitWorktreeManager } from '@fleet/workspace';

import { ValidationRunner } from './runner.js';
import { statOf } from './runner.js';
import type { ValidationProfile } from './types.js';

/**
 * T008 状态矩阵（SC-002）：pass/fail/skipped×2 原因/timeout ×
 * 检查类，全结构化断言；noop 短路；顺序确定；主仓零写入。
 * tmp git 仓库 + 真 GitWorktreeManager + 替身检查脚本。
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

function profileOf(
  partial: Partial<ValidationProfile> = {},
): ValidationProfile {
  return {
    checks: {
      lint: { command: 'echo lint-ok', required: true },
      typecheck: { required: false },
      tests: { command: 'echo tests-ok', required: true },
    },
    timeoutMs: 5000,
    maxReviewLoops: 2,
    ...partial,
  };
}

beforeAll(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'fleet-val-'));
  git('init -q -b main');
  writeFileSync(path.join(repo, '.gitignore'), '.fleet/\n');
  writeFileSync(path.join(repo, 'base.txt'), 'baseline\n');
  git('add -A');
  git('commit -qm baseline');
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

async function workspaceWithChange(taskId: string, change: string) {
  const manager = new GitWorktreeManager(repo, { git: { env: GIT_ENV } });
  const workspace = await manager.create(taskId, { runId: 'run_val0001' });
  writeFileSync(path.join(workspace.path, `${taskId}.txt`), change);
  return { manager, workspace };
}

describe('ValidationRunner（SC-002 状态矩阵）', () => {
  it('全通过：diff/lint/tests pass、typecheck skipped（not-configured）→ overall pass', async () => {
    const { manager, workspace } = await workspaceWithChange(
      'm-pass',
      'change\n',
    );
    const runner = new ValidationRunner({ manager, profile: profileOf() });
    const artifact = await runner.validate({
      taskId: 'm-pass',
      workspace,
      loop: 0,
      runId: 'run_val0001',
    });
    expect(artifact.id).toMatch(/^art_[0-9a-f-]{36}$/);
    expect(artifact.overall).toBe('pass');
    expect(artifact.checks.map((check) => check.kind)).toEqual([
      'diff',
      'lint',
      'typecheck',
      'tests',
    ]);
    const byKind = Object.fromEntries(
      artifact.checks.map((check) => [check.kind, check]),
    );
    expect(byKind.diff!.status).toBe('pass');
    expect(byKind.diff!.required).toBe(true);
    expect(byKind.lint).toMatchObject({ status: 'pass', exitCode: 0 });
    expect(byKind.typecheck).toMatchObject({
      status: 'skipped',
      skipReason: 'not-configured',
      required: false,
    });
    expect(byKind.tests).toMatchObject({ status: 'pass' });
    expect(artifact.diffStat).toMatchObject({ files: 1, insertions: 1 });
    expect(git('status --porcelain').trim()).toBe(''); // 主仓零写入
  });

  it('检查失败：tests 非零退出 → overall fail + 输出摘要可见（不短路后续）', async () => {
    const { manager, workspace } = await workspaceWithChange('m-fail', 'x\n');
    const runner = new ValidationRunner({
      manager,
      profile: profileOf({
        checks: {
          lint: { command: 'echo lint-fail >&2; exit 3', required: true },
          typecheck: { required: false },
          tests: { command: 'echo tests-fail; exit 1', required: true },
        },
      }),
    });
    const artifact = await runner.validate({
      taskId: 'm-fail',
      workspace,
      loop: 2,
    });
    expect(artifact.overall).toBe('fail');
    expect(artifact.loop).toBe(2);
    expect(artifact.runId).toBe('adhoc');
    const byKind = Object.fromEntries(
      artifact.checks.map((check) => [check.kind, check]),
    );
    expect(byKind.lint).toMatchObject({ status: 'fail', exitCode: 3 });
    expect(byKind.lint!.outputExcerpt).toContain('lint-fail');
    expect(byKind.tests).toMatchObject({ status: 'fail' }); // 不短路
  });

  it('超时：hang 命令 → status=timeout（按 fail 计）+ 已运行时长标注', async () => {
    const { manager, workspace } = await workspaceWithChange('m-hang', 'x\n');
    const runner = new ValidationRunner({
      manager,
      profile: profileOf({
        checks: {
          lint: { command: 'sleep 5', required: true },
          typecheck: { required: false },
          tests: { command: 'echo ok', required: true },
        },
        timeoutMs: 300,
      }),
    });
    const artifact = await runner.validate({
      taskId: 'm-hang',
      workspace,
      loop: 0,
    });
    expect(artifact.overall).toBe('fail');
    const lint = artifact.checks.find((check) => check.kind === 'lint')!;
    expect(lint.status).toBe('timeout');
    expect(lint.outputExcerpt).toContain('超时 @');
    expect(lint.durationMs).toBeGreaterThanOrEqual(250);
  });

  it('空 diff：noop + 其余检查 skipped（empty-diff）', async () => {
    const manager = new GitWorktreeManager(repo, { git: { env: GIT_ENV } });
    const workspace = await manager.create('m-noop', { runId: 'run_val0001' });
    const runner = new ValidationRunner({ manager, profile: profileOf() });
    const artifact = await runner.validate({
      taskId: 'm-noop',
      workspace,
      loop: 0,
    });
    expect(artifact.overall).toBe('noop');
    expect(artifact.diffStat).toEqual({
      files: 0,
      insertions: 0,
      deletions: 0,
    });
    for (const check of artifact.checks.slice(1)) {
      expect(check).toMatchObject({
        status: 'skipped',
        skipReason: 'empty-diff',
      });
    }
  });

  it('命令不存在 → 该检查 fail（必选语义）+ Runner 不崩溃', async () => {
    const { manager, workspace } = await workspaceWithChange('m-nocmd', 'x\n');
    const runner = new ValidationRunner({
      manager,
      profile: profileOf({
        checks: {
          lint: { command: './definitely-missing-cmd-xyz', required: true },
          typecheck: { required: false },
          tests: { command: 'echo ok', required: true },
        },
      }),
    });
    const artifact = await runner.validate({
      taskId: 'm-nocmd',
      workspace,
      loop: 0,
    });
    expect(artifact.overall).toBe('fail');
    expect(artifact.checks.find((check) => check.kind === 'lint')!.status).toBe(
      'fail',
    );
  });

  it('输出截断：超长输出头尾保留 + 标注（SC-002 边缘）', async () => {
    const { manager, workspace } = await workspaceWithChange('m-trunc', 'x\n');
    const runner = new ValidationRunner({
      manager,
      profile: profileOf({
        checks: {
          lint: {
            command:
              'head -c 20000 /dev/zero | tr "\\0" "a"; echo; echo TAIL-MARKER',
            required: true,
          },
          typecheck: { required: false },
          tests: { command: 'echo ok', required: true },
        },
      }),
    });
    const artifact = await runner.validate({
      taskId: 'm-trunc',
      workspace,
      loop: 0,
    });
    const lint = artifact.checks.find((check) => check.kind === 'lint')!;
    expect(lint.outputExcerpt).toContain('已截断');
    expect(lint.outputExcerpt.endsWith('TAIL-MARKER')).toBe(true); // 尾部保留
    expect(lint.outputExcerpt.length).toBeLessThan(10_000);
  });
});

describe('statOf（diff 统计）', () => {
  it('增删行与新文件计数', () => {
    const diff = [
      'diff --git a/x b/x',
      '--- a/x',
      '+++ b/x',
      '-old',
      '+new',
      '+newer',
      'diff --git a/bin b/bin',
      'Binary files differ',
    ].join('\n');
    expect(statOf(diff)).toEqual({ files: 2, insertions: 2, deletions: 1 });
  });
});
