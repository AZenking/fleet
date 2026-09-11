import { execa } from 'execa';

import type { WorkspaceFault } from './types.js';

/**
 * 受控 git 子进程（research.md D3）：统一超时（5s）、stdin ignore、
 * 非零退出 / 超时 → 结构化 WorkspaceFault（stderr 首行进 detail）。
 */

export const GIT_TIMEOUT_MS = 5000;

/** git 子进程配置注入（测试可替换 git 命令名 / env） */
export interface GitContext {
  repoRoot: string;
  env?: Record<string, string>;
  /** 测试注入：git 命令名（缺省 'git'） */
  command?: string;
}

export type GitResult =
  { ok: true; stdout: string } | { ok: false; fault: WorkspaceFault };

export async function runGit(
  ctx: GitContext,
  cwd: string,
  args: string[],
): Promise<GitResult> {
  try {
    const result = await execa(ctx.command ?? 'git', args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      reject: false,
      stdin: 'ignore',
      ...(ctx.env !== undefined ? { env: { ...process.env, ...ctx.env } } : {}),
    });
    if (result.exitCode !== 0) {
      return {
        ok: false,
        fault: {
          code: 'git_failed',
          detail: `git ${args[0] ?? ''} 退出码 ${result.exitCode}：${firstLine(result.stderr || result.stdout)}`,
        },
      };
    }
    return { ok: true, stdout: result.stdout };
  } catch (error) {
    return {
      ok: false,
      fault: {
        code: 'git_failed',
        detail: `git ${args[0] ?? ''} 执行失败：${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
}

export function isGitRepo(ctx: GitContext): Promise<GitResult> {
  return runGit(ctx, ctx.repoRoot, ['rev-parse', '--is-inside-work-tree']);
}

export function headSha(ctx: GitContext): Promise<GitResult> {
  return runGit(ctx, ctx.repoRoot, ['rev-parse', 'HEAD']);
}

export function statusPorcelain(ctx: GitContext): Promise<GitResult> {
  return runGit(ctx, ctx.repoRoot, ['status', '--porcelain']);
}

export function branchExists(
  ctx: GitContext,
  branch: string,
): Promise<GitResult> {
  return runGit(ctx, ctx.repoRoot, ['branch', '--list', branch]);
}

export function worktreeList(ctx: GitContext): Promise<GitResult> {
  return runGit(ctx, ctx.repoRoot, ['worktree', 'list', '--porcelain']);
}

function firstLine(text: string): string {
  return (text.split('\n')[0] ?? '').trim();
}
