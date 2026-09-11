import { realpathSync } from 'node:fs';
import path from 'node:path';

import { runGit, worktreeList, type GitContext } from './git.js';
import { GitWorktreeManager, WORKTREES_DIR } from './manager.js';
import type {
  DestroyOutcome,
  OrphanEntry,
  WorkspaceInventory,
} from './types.js';

/**
 * 孤儿检测与最小清理（research.md D4，M11 前的最小集）：
 * 真相源 = git worktree list；孤儿 = 位于 .fleet/worktrees/ 下
 * 且不在本管理器活动清单。跨进程"无人认领"判定属 M11 Recovery。
 */

export function inventoryOf(
  manager: GitWorktreeManager,
): Promise<WorkspaceInventory> {
  return buildInventory(manager);
}

export async function buildInventory(
  manager: GitWorktreeManager,
): Promise<WorkspaceInventory> {
  const active = manager.activeWorkspaces();
  // macOS tmp 的 /var ↔ /private/var 符号链接：统一 realpath 再比对
  const activePaths = new Set(
    active.map((workspace) => realPath(workspace.path)),
  );
  const ctx: GitContext = {
    repoRoot: (manager as unknown as { repoRoot: string }).repoRoot,
  };

  const listed = await worktreeList(ctx);
  const orphans: OrphanEntry[] = [];
  if (listed.ok) {
    const prefix = path.join(realPath(ctx.repoRoot), WORKTREES_DIR);
    let currentPath: string | undefined;
    for (const line of listed.stdout.split('\n')) {
      if (line.startsWith('worktree ')) {
        currentPath = line.slice('worktree '.length).trim();
        if (
          currentPath.startsWith(prefix) &&
          !activePaths.has(realPath(currentPath))
        ) {
          orphans.push({
            path: currentPath,
            detectedAt: new Date().toISOString(),
          });
        }
      } else if (
        line.startsWith('branch ') &&
        orphans.at(-1)?.branch === undefined &&
        currentPath !== undefined
      ) {
        const entry = orphans.at(-1);
        if (entry?.path === currentPath) {
          entry.branch = line.slice('branch '.length).trim();
        }
      }
    }
  }
  return { active, orphans };
}

/** 孤儿清理 = destroy 同序列（目录 + 分支） */
export async function cleanupOrphan(
  manager: GitWorktreeManager,
  orphan: OrphanEntry,
): Promise<DestroyOutcome> {
  const ctx: GitContext = {
    repoRoot: (manager as unknown as { repoRoot: string }).repoRoot,
  };
  const residual: string[] = [];

  const pruned = await runGit(ctx, ctx.repoRoot, [
    'worktree',
    'remove',
    '--force',
    orphan.path,
  ]);
  if (!pruned.ok) {
    // 目录已不存在 → prune 兜底（幂等语义）
    const pruned2 = await runGit(ctx, ctx.repoRoot, ['worktree', 'prune']);
    const stillThere = pruned2.ok ? false : true;
    if (stillThere) {
      residual.push(`worktree: ${orphan.path}（${pruned.fault.detail}）`);
    }
  }
  if (orphan.branch !== undefined) {
    const branch = await runGit(ctx, ctx.repoRoot, [
      'branch',
      '-D',
      orphan.branch,
    ]);
    if (!branch.ok && !branch.fault.detail.includes('not found')) {
      residual.push(`branch: ${orphan.branch}（${branch.fault.detail}）`);
    }
  }
  return residual.length === 0
    ? { ok: true, residual: [] }
    : { ok: false, residual };
}

function realPath(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    return target;
  }
}
