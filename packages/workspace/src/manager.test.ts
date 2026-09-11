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

import { GitWorktreeManager, WorkspaceCreateError } from './manager.js';
import { buildInventory, cleanupOrphan } from './inventory.js';
import { runGit } from './git.js';

/**
 * US1 生命周期（T006）+ US3 故障矩阵（T011）+ 孤儿（T012）：
 * tmp git 夹具仓库驱动——零触碰本仓库。
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

function manager(
  options?: ConstructorParameters<typeof GitWorktreeManager>[1],
) {
  return new GitWorktreeManager(repo, { git: { env: GIT_ENV }, ...options });
}

beforeAll(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'fleet-ws-'));
  git('init -q -b main');
  writeFileSync(path.join(repo, '.gitignore'), '.fleet/\n');
  writeFileSync(path.join(repo, 'base.txt'), 'baseline\n');
  git('add -A');
  git('commit -qm baseline');
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('US1：生命周期（SC-001）', () => {
  it('create → 写 → getDiff（含未跟踪）→ merge → destroy 零残留', async () => {
    const m = manager();
    const ws = await m.create('lifecycle-task', { runId: 'run_lifecycle01' });
    expect(ws.status).toBe('active');
    expect(ws.branch).toBe('fleet/lifecycl/lifecycle-task');
    expect(existsSync(ws.path)).toBe(true);
    expect(existsSync(path.join(ws.path, 'base.txt'))).toBe(true); // 基线内容可见

    // 修改 + 新文件
    writeFileSync(path.join(ws.path, 'base.txt'), 'changed\n');
    writeFileSync(path.join(ws.path, 'new-file.txt'), 'brand new\n');
    const diff = await m.getDiff(ws);
    expect(diff).toContain('changed');
    expect(diff).toContain('new-file.txt'); // 未跟踪文件进 diff

    const merge = await m.merge(ws);
    expect(merge.kind).toBe('merged');
    if (merge.kind === 'merged') {
      expect(merge.commit).toMatch(/^[0-9a-f]{7,40}$/);
    }
    // 主分支可见变更
    expect(existsSync(path.join(repo, 'new-file.txt'))).toBe(true);
    expect(
      execSync('git show HEAD:base.txt', { cwd: repo }).toString(),
    ).toContain('changed');

    const destroy = await m.destroy(ws);
    expect(destroy.ok).toBe(true);
    expect(existsSync(ws.path)).toBe(false);
    expect(git('branch --list').trim()).not.toContain(ws.branch);
    expect(git('status --porcelain').trim()).toBe(''); // 主仓干净
  });

  it('runId 缺省 adhoc；runShort 截短', async () => {
    const m = manager();
    const ws = await m.create('adhoc-task');
    expect(ws.branch).toBe('fleet/adhoc/adhoc-task');
    await m.destroy(ws);
  });

  it('空 diff merge = noop（不算失败）', async () => {
    const m = manager();
    const ws = await m.create('noop-task');
    expect((await m.merge(ws)).kind).toBe('noop');
    await m.destroy(ws);
  });

  it('二进制文件 diff 有标注', async () => {
    const m = manager();
    const ws = await m.create('binary-task');
    writeFileSync(
      path.join(ws.path, 'image.bin'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]),
    );
    const diff = await m.getDiff(ws);
    expect(diff.toLowerCase()).toContain('binary');
    await m.destroy(ws);
  });

  it('destroy 幂等（资源已不存在 → ok）', async () => {
    const m = manager();
    const ws = await m.create('idem-task');
    await m.destroy(ws);
    const again = await m.destroy(ws);
    expect(again.ok).toBe(true);
  });

  it('merge 冲突：不强合 + 文件清单 + 双方保持 pre-merge', async () => {
    const m = manager();
    const ws = await m.create('conflict-task');
    writeFileSync(path.join(ws.path, 'base.txt'), 'worktree side\n');

    // 主仓同位置改（制造分叉）
    writeFileSync(path.join(repo, 'base.txt'), 'main side\n');
    git('add -A');
    git('commit -qm main-side');
    // 主仓临时 dirty 的善后：commit 后干净 ✓

    const merge = await m.merge(ws);
    expect(merge.kind).toBe('conflict');
    if (merge.kind === 'conflict') {
      expect(merge.files).toContain('base.txt');
    }
    // 双方保持 pre-merge：主仓内容 = main side（未强合）
    expect(execSync('cat base.txt', { cwd: repo }).toString()).toContain(
      'main side',
    );
    // worktree 侧仍在（可重试 / destroy）
    expect(existsSync(ws.path)).toBe(true);
    await m.destroy(ws);
  });
});

describe('US3：故障矩阵（SC-003）', () => {
  it('dirty 主仓 → dirty_main（detail 含首个脏文件）', async () => {
    writeFileSync(path.join(repo, 'dirty.txt'), 'stain\n');
    try {
      const m = manager();
      await expect(m.create('dirty-task')).rejects.toMatchObject({
        fault: { code: 'dirty_main' },
      });
      // 抛出的 detail 含文件名
      try {
        await m.create('dirty-task');
      } catch (error) {
        expect((error as WorkspaceCreateError).fault.detail).toContain(
          'dirty.txt',
        );
      }
    } finally {
      rmSync(path.join(repo, 'dirty.txt'));
    }
  });

  it('残留同名分支 → branch_collision（残留判定提示）', async () => {
    git('branch fleet/9abc1234/residue-task');
    try {
      await expect(
        manager().create('residue-task', { runId: 'run_9abc1234ef' }),
      ).rejects.toMatchObject({ fault: { code: 'branch_collision' } });
    } finally {
      git('branch -D fleet/9abc1234/residue-task');
    }
  });

  it('上限触发 → limit_exceeded', async () => {
    const m = manager({ maxWorkspaces: undefined, maxWorktrees: 1 });
    const ws = await m.create('cap-one');
    await expect(m.create('cap-two')).rejects.toMatchObject({
      fault: { code: 'limit_exceeded' },
    });
    await m.destroy(ws);
  });

  it('非 git 仓库目录 → not_a_git_repo；空仓 → empty_repo', async () => {
    const notRepo = mkdtempSync(path.join(tmpdir(), 'fleet-notrepo-'));
    try {
      await expect(
        new GitWorktreeManager(notRepo).create('x'),
      ).rejects.toMatchObject({ fault: { code: 'not_a_git_repo' } });
      const emptyRepo = mkdtempSync(path.join(tmpdir(), 'fleet-empty-'));
      try {
        execSync('git init -q -b main', { cwd: emptyRepo });
        await expect(
          new GitWorktreeManager(emptyRepo).create('x'),
        ).rejects.toMatchObject({ fault: { code: 'empty_repo' } });
      } finally {
        rmSync(emptyRepo, { recursive: true, force: true });
      }
    } finally {
      rmSync(notRepo, { recursive: true, force: true });
    }
  });
});

describe('US3：孤儿检测与清理（SC-004）', () => {
  it('残留 worktree（跳过 destroy 模拟崩溃）→ 检测命中 → 清理归零', async () => {
    const holder = manager();
    const ws = await holder.create('orphan-task', { runId: 'run_orphan0001' });
    // 模拟持有进程消失：新管理器（无活动清单）看到孤儿
    const fresh = manager();
    const before = await buildInventory(fresh);
    // macOS /var ↔ /private/var：比对前 realpath 归一
    const wsReal = realpathSync(ws.path);
    expect(
      before.orphans.some((entry) => realpathSync(entry.path) === wsReal),
    ).toBe(true);

    const orphan = before.orphans.find(
      (entry) => realpathSync(entry.path) === wsReal,
    )!;
    const cleanup = await cleanupOrphan(fresh, orphan);
    expect(cleanup.ok).toBe(true);

    const after = await buildInventory(fresh);
    expect(after.orphans).toHaveLength(0);
    expect(existsSync(ws.path)).toBe(false);
    // 活动清单（原管理器）不影响 git 真相：分支也被清
    const branchList = runGit({ repoRoot: repo }, repo, ['branch', '--list']);
    expect(branchList.ok ? branchList.stdout : '').not.toContain(ws.branch);
  });

  it('活动 worktree 不被误报为孤儿', async () => {
    const m = manager();
    const ws = await m.create('alive-task');
    const inv = await buildInventory(m);
    expect(inv.active.some((entry) => entry.path === ws.path)).toBe(true);
    expect(inv.orphans.some((entry) => entry.path === ws.path)).toBe(false);
    await m.destroy(ws);
  });
});
