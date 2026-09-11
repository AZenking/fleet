/**
 * 工作区实体（data-model.md §1–§6）。
 *
 * 物理隔离层：写授权任务（M7 矩阵 reason/reflex）在专属 Git
 * Worktree 执行，主仓全程零污染（宪法 II 物理落点）。故障全部
 * 结构化（code + detail），零崩溃零主仓污染。
 */

export const WORKSPACE_STATUSES = [
  'active',
  'merged',
  'conflict',
  'destroyed',
] as const;
export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

export interface Workspace {
  taskId: string;
  runId: string;
  /** `.fleet/worktrees/<runShort>-<taskId>`（绝对路径） */
  path: string;
  /** `fleet/<runShort>/<taskId>` */
  branch: string;
  /** create 时的主仓 HEAD（sha） */
  baseline: string;
  status: WorkspaceStatus;
}

export type MergeOutcome =
  | { kind: 'merged'; commit: string }
  | { kind: 'conflict'; files: string[] }
  | { kind: 'noop' }
  | { kind: 'rejected'; reason: string };

export interface DestroyOutcome {
  ok: boolean;
  /** cleanup_partial 时的残留项（worktree / branch 描述） */
  residual: string[];
}

export const WORKSPACE_FAULT_CODES = [
  'not_a_git_repo',
  'empty_repo',
  'dirty_main',
  'branch_collision',
  'limit_exceeded',
  'cleanup_partial',
  'git_failed',
] as const;
export type WorkspaceFaultCode = (typeof WORKSPACE_FAULT_CODES)[number];

export interface WorkspaceFault {
  code: WorkspaceFaultCode;
  detail: string;
}

/** WorkspaceManager 接口（roadmap 签名） */
export interface WorkspaceManager {
  create(taskId: string, options?: { runId?: string }): Promise<Workspace>;
  getDiff(workspace: Workspace): Promise<string>;
  merge(workspace: Workspace): Promise<MergeOutcome>;
  destroy(workspace: Workspace): Promise<DestroyOutcome>;
}

export interface OrphanEntry {
  path: string;
  branch?: string;
  detectedAt: string;
}

export interface WorkspaceInventory {
  active: Workspace[];
  orphans: OrphanEntry[];
}

/** 处置记录（RunReport.workspaces 的元素形态） */
export type WorkspaceDisposition = {
  taskId: string;
  action: 'merged' | 'destroyed' | 'kept' | 'conflict';
  outcome?: string;
  detail?: string;
};
