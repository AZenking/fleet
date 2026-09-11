/**
 * 工作区实体（data-model.md §1–§6）。
 *
 * 物理隔离层：写授权任务（M7 矩阵 reason/reflex）在专属 Git
 * Worktree 执行，主仓全程零污染（宪法 II 物理落点）。故障全部
 * 结构化（code + detail），零崩溃零主仓污染。
 */

import type { Task } from '@fleet/mission';

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

/**
 * M9 验证门端口：生命周期（worktree 创建/处置）留 workspace，
 * 判定（验证/审阅/循环）归 gate 实现（@fleet/validation）。端口
 * 放生命周期所有方——与 scheduler 持有 TaskExecutor 同一模式。
 */
export interface GateEvaluation {
  task: Task;
  workspace: Workspace;
  /** 首跑实现结果（ok=false → gate 应直接 fix_failed，M5 语义） */
  execution: { ok: boolean; detail?: string };
  /** 修复轮次入口：inner 二次执行（反馈 = 验证失败摘要 / 审阅意见） */
  reexecute: (feedback: string) => Promise<{ ok: boolean; detail?: string }>;
}

export const GATE_OUTCOMES = [
  'approved',
  'review_exceeded',
  'review_error',
  'fix_failed',
] as const;
export type GateOutcome = (typeof GATE_OUTCOMES)[number];

export interface GateDecision {
  pass: boolean;
  outcome: GateOutcome;
  detail?: string;
  /**
   * false = 确定性终态结论（scheduler 不重试——重试不改判，
   * 防止轮次预算被 M5 retry 翻倍，research.md D3）
   */
  retryable?: boolean;
}

/** gate 报告面（结构化形态由实现方定义；runner duck-typing 合成） */
export interface GateReportFace {
  readonly packages: unknown[];
}

export interface WorkspaceGate extends GateReportFace {
  evaluate(evaluation: GateEvaluation): Promise<GateDecision>;
}
