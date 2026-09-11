import path from 'node:path';

import {
  branchExists,
  headSha,
  isGitRepo,
  runGit,
  statusPorcelain,
  type GitContext,
} from './git.js';
import type {
  DestroyOutcome,
  MergeOutcome,
  Workspace,
  WorkspaceFault,
  WorkspaceManager,
} from './types.js';

/**
 * GitWorktreeManager（research.md D2/D3）：
 * create 五重前置校验 → worktree add；getDiff 用 intent-to-add
 * （未跟踪文件进 diff）；merge 不强合（冲突 abort 双方回
 * pre-merge）；destroy 幂等 + 残留报告。
 */

export const WORKTREES_DIR = '.fleet/worktrees';

export interface GitWorktreeManagerOptions {
  /** 活动 worktree 上限（默认 8） */
  maxWorktrees?: number;
  /** 测试注入：git 命令名 / env */
  git?: { command?: string; env?: Record<string, string> };
}

export class WorkspaceCreateError extends Error {
  constructor(readonly fault: WorkspaceFault) {
    super(`工作区创建失败（${fault.code}）：${fault.detail}`);
    this.name = 'WorkspaceCreateError';
  }
}

function shortRun(runId: string): string {
  const stripped = runId.replace(/^run_/, '');
  return stripped.slice(0, 8) || 'adhoc';
}

export class GitWorktreeManager implements WorkspaceManager {
  private readonly ctx: GitContext;
  private readonly active = new Map<string, Workspace>();
  /** git 变更操作串行队列——并行批次并发 create/merge 会撞 git 锁 */
  private chain: Promise<unknown> = Promise.resolve();
  readonly maxWorktrees: number;

  /** 串行执行（执行层仍并行——只序列化毫秒级的 git 变更） */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  constructor(
    readonly repoRoot: string,
    options: GitWorktreeManagerOptions = {},
  ) {
    this.ctx = { repoRoot, ...(options.git ?? {}) };
    this.maxWorktrees = options.maxWorktrees ?? 8;
  }

  create(taskId: string, options: { runId?: string } = {}): Promise<Workspace> {
    return this.enqueue(() => this.createInternal(taskId, options));
  }

  private async createInternal(
    taskId: string,
    options: { runId?: string } = {},
  ): Promise<Workspace> {
    const runId = options.runId ?? 'adhoc';
    const runShort = shortRun(runId);
    const branch = `fleet/${runShort}/${taskId}`;
    const worktreePath = path.join(
      this.repoRoot,
      WORKTREES_DIR,
      `${runShort}-${taskId}`,
    );

    // 五重前置校验（任一失败 → 结构化 fault，不产生资源）
    const repo = await isGitRepo(this.ctx);
    if (!repo.ok) {
      throw new WorkspaceCreateError(faultOf(repo, 'not_a_git_repo'));
    }
    const head = await headSha(this.ctx);
    if (!head.ok) {
      throw new WorkspaceCreateError(faultOf(head, 'empty_repo'));
    }
    const status = await statusPorcelain(this.ctx);
    if (!status.ok) {
      throw new WorkspaceCreateError(status.fault);
    }
    if (status.stdout.trim() !== '') {
      throw new WorkspaceCreateError({
        code: 'dirty_main',
        detail: `主仓有未提交变更（首个：${status.stdout.split('\n')[0]?.trim() ?? '?'}）——先提交或储藏，保证基线可复现`,
      });
    }
    const existing = await branchExists(this.ctx, branch);
    if (!existing.ok) {
      throw new WorkspaceCreateError(existing.fault);
    }
    if (existing.stdout.trim() !== '') {
      const knownActive = [...this.active.values()].some(
        (workspace) => workspace.branch === branch,
      );
      throw new WorkspaceCreateError({
        code: 'branch_collision',
        detail: `分支 ${branch} 已存在${knownActive ? '（本进程活动工作区——taskId 重复？）' : '（疑似残留：可用 inventory 检测孤儿并清理）'}`,
      });
    }
    if (this.active.size >= this.maxWorktrees) {
      throw new WorkspaceCreateError({
        code: 'limit_exceeded',
        detail: `活动工作区已达上限 ${this.maxWorktrees}`,
      });
    }

    const added = await runGit(this.ctx, this.repoRoot, [
      'worktree',
      'add',
      '-b',
      branch,
      worktreePath,
      'HEAD',
    ]);
    if (!added.ok) {
      throw new WorkspaceCreateError(added.fault);
    }

    const workspace: Workspace = {
      taskId,
      runId,
      path: worktreePath,
      branch,
      baseline: head.stdout.trim(),
      status: 'active',
    };
    this.active.set(workspace.branch, workspace);
    return workspace;
  }

  async getDiff(workspace: Workspace): Promise<string> {
    // intent-to-add：未跟踪新文件进 diff（只动隔离区 index）
    await runGit(this.ctx, workspace.path, ['add', '-A', '-N']);
    const diff = await runGit(this.ctx, workspace.path, ['diff', 'HEAD']);
    if (!diff.ok) {
      throw new Error(`getDiff 失败：${diff.fault.detail}`);
    }
    return diff.stdout;
  }

  merge(workspace: Workspace): Promise<MergeOutcome> {
    return this.enqueue(() => this.mergeInternal(workspace));
  }

  private async mergeInternal(workspace: Workspace): Promise<MergeOutcome> {
    // 空 diff → noop（以工作树状态判定，不解析 git 输出文本）
    const staged = await runGit(this.ctx, workspace.path, ['add', '-A']);
    if (!staged.ok) {
      return { kind: 'rejected', reason: staged.fault.detail };
    }
    const wsStatus = await runGit(this.ctx, workspace.path, [
      'status',
      '--porcelain',
    ]);
    if (wsStatus.ok && wsStatus.stdout.trim() === '') {
      return { kind: 'noop' };
    }
    const committed = await runGit(this.ctx, workspace.path, [
      'commit',
      '-m',
      `fleet: ${workspace.taskId}`,
    ]);
    if (!committed.ok) {
      return { kind: 'rejected', reason: committed.fault.detail };
    }

    const merged = await runGit(this.ctx, this.repoRoot, [
      'merge',
      '--no-ff',
      '-m',
      `fleet: merge ${workspace.taskId}`,
      workspace.branch,
    ]);
    if (merged.ok) {
      const head = await headSha(this.ctx);
      workspace.status = 'merged';
      this.active.delete(workspace.branch);
      return {
        kind: 'merged',
        commit: head.ok ? head.stdout.trim() : workspace.baseline,
      };
    }

    // 失败判定不解析输出文本：以未合并文件（UU/AA 等）为准
    const files = await this.conflictFiles();
    await runGit(this.ctx, this.repoRoot, ['merge', '--abort']);
    if (files.length > 0) {
      workspace.status = 'conflict';
      return { kind: 'conflict', files };
    }
    return { kind: 'rejected', reason: merged.fault.detail };
  }

  destroy(workspace: Workspace): Promise<DestroyOutcome> {
    return this.enqueue(() => this.destroyInternal(workspace));
  }

  private async destroyInternal(workspace: Workspace): Promise<DestroyOutcome> {
    const residual: string[] = [];
    const removed = await runGit(this.ctx, this.repoRoot, [
      'worktree',
      'remove',
      '--force',
      workspace.path,
    ]);
    if (
      !removed.ok &&
      !removalAlreadyDone(removed.fault.detail, workspace.path)
    ) {
      residual.push(`worktree: ${workspace.path}（${removed.fault.detail}）`);
    }
    const branch = await runGit(this.ctx, this.repoRoot, [
      'branch',
      '-D',
      workspace.branch,
    ]);
    if (!branch.ok && !branch.fault.detail.includes('not found')) {
      residual.push(`branch: ${workspace.branch}（${branch.fault.detail}）`);
    }
    workspace.status = 'destroyed';
    this.active.delete(workspace.branch);
    return residual.length === 0
      ? { ok: true, residual: [] }
      : { ok: false, residual };
  }

  /** 活动清单（inventory 消费） */
  activeWorkspaces(): Workspace[] {
    return [...this.active.values()];
  }

  private async conflictFiles(): Promise<string[]> {
    const status = await runGit(this.ctx, this.repoRoot, [
      'diff',
      '--name-only',
      '--diff-filter=U',
    ]);
    return status.ok
      ? status.stdout
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
      : [];
  }
}

function faultOf(
  result: { fault: WorkspaceFault },
  code: WorkspaceFault['code'],
): WorkspaceFault {
  return { code, detail: result.fault.detail };
}

function removalAlreadyDone(detail: string, worktreePath: string): boolean {
  return (
    detail.includes('already exists') === false &&
    (detail.includes('does not exist') ||
      detail.includes('not a working tree') ||
      detail.includes(worktreePath))
  );
}
