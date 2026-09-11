import { execSync } from 'node:child_process';
import process from 'node:process';

import {
  GitWorktreeManager,
  buildInventory,
  cleanupOrphan,
} from '@fleet/workspace';
import type { OrphanEntry } from '@fleet/workspace';

/**
 * OrphanReport（research.md D6）：孤儿 worktree 复用 M8 inventory
 * （真相源 = git worktree list 对照活动清单）；孤儿进程按命令行
 * FLEET_CHILD=1 派生标记识别（CliRuntimeAdapter 经 /usr/bin/env
 * 前缀注入——ps 可见，不误杀无辜同名进程）。清理缺省 dry-run。
 */

export interface OrphanProcess {
  pid: number;
  command: string;
}

export interface OrphanReport {
  worktrees: OrphanEntry[];
  processes: OrphanProcess[];
}

export async function scanOrphans(repoRoot: string): Promise<OrphanReport> {
  const inventory = await buildInventory(new GitWorktreeManager(repoRoot));
  return {
    worktrees: inventory.orphans,
    processes: scanOrphanProcesses(),
  };
}

/** 派生标记签名（bash 包装层 argv 前缀——精确匹配，不误杀提及者） */
export const FLEET_CHILD_SIGNATURE = '/bin/bash -c export FLEET_CHILD=1;';

/** ps 扫描：命令行以派生签名开头的进程（macOS 本地） */
export function scanOrphanProcesses(): OrphanProcess[] {
  let output: string;
  try {
    output = execSync('ps -eo pid=,command=', { encoding: 'utf8' });
  } catch {
    return [];
  }
  const processes: OrphanProcess[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    const match = /^(\d+)\s+(.*)$/.exec(trimmed);
    if (match === null) {
      continue;
    }
    // 前缀精确匹配：仅 Fleet 派生的 bash 包装层（提及字符串的
    // 外层 shell / 无关进程不匹配——不误杀）
    if (match[2]!.startsWith(FLEET_CHILD_SIGNATURE)) {
      processes.push({ pid: Number(match[1]), command: match[2]! });
    }
  }
  return processes;
}

/** SIGTERM 孤儿进程（已退出视为已清理——不抛） */
function killProcess(pid: number): void {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // 已退出
  }
}

export interface CleanupResult {
  cleaned: string[];
}

/** dry-run 缺省；force：进程 SIGTERM + worktree 最小清理（M8 原语） */
export async function cleanupOrphans(
  repoRoot: string,
  report: OrphanReport,
  options: { force: boolean },
): Promise<CleanupResult> {
  if (!options.force) {
    return { cleaned: [] };
  }
  const cleaned: string[] = [];
  for (const entry of report.processes) {
    killProcess(entry.pid);
    cleaned.push(`process:${entry.pid}`);
  }
  const manager = new GitWorktreeManager(repoRoot);
  for (const orphan of report.worktrees) {
    await cleanupOrphan(manager, orphan);
    cleaned.push(`worktree:${orphan.path}`);
  }
  return { cleaned };
}
