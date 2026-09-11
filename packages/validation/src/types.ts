/**
 * 独立验收域实体（data-model.md §1–§8）。
 *
 * 宪法 III（NON-NEGOTIABLE）：最终 Validation 由 Fleet 独立执行；
 * 实现者自报不进判定路径。ValidationArtifact 是 Mission 验收的
 * 唯一证据源；Review Loop 有固定上限（结构性不可能无限循环）。
 */

import type { Mission } from '@fleet/mission';
import type { Workspace } from '@fleet/workspace';

export const CHECK_KINDS = ['diff', 'lint', 'typecheck', 'tests'] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];

/** 可配置命令的三类检查（diff 走 M8 git 语义，非命令） */
export const COMMAND_KINDS = ['lint', 'typecheck', 'tests'] as const;
export type CommandKind = (typeof COMMAND_KINDS)[number];

export const CHECK_STATUSES = ['pass', 'fail', 'skipped', 'timeout'] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export interface ValidationCheck {
  kind: CheckKind;
  /** 实际执行命令（diff = 内建 git 语义则 undefined） */
  command?: string;
  status: CheckStatus;
  /** 子进程退出码（命令执行时必有） */
  exitCode?: number;
  /** 头 2KB + 尾 2KB 截断 + 标注 */
  outputExcerpt: string;
  durationMs: number;
  /** 证据类型（宪法 I 可追溯：diff→config、lint/typecheck→runtime、tests→test） */
  evidence: 'config' | 'runtime' | 'test';
  /** skipped 时必有：empty-diff | not-configured */
  skipReason?: string;
  /** 显式配置或探测到 = true；未探测到 = false（skipped 不算失败） */
  required: boolean;
}

export const ARTIFACT_OVERALLS = ['pass', 'fail', 'noop'] as const;
export type ArtifactOverall = (typeof ARTIFACT_OVERALLS)[number];

export interface DiffStat {
  files: number;
  insertions: number;
  deletions: number;
}

export interface ValidationArtifact {
  /** art_ 前缀 + UUID（core createId） */
  id: string;
  taskId: string;
  runId: string;
  /** worktree 路径（追溯锚点） */
  workspaceRef: string;
  /** 当前轮次序号（首跑 0，每修复 +1） */
  loop: number;
  /** 固定顺序 diff → lint → typecheck → tests */
  checks: ValidationCheck[];
  /** noop ⟺ diff 空；任一 required 检查 fail/timeout → fail */
  overall: ArtifactOverall;
  diffStat: DiffStat;
  createdAt: string;
}

/** Profile 解析结果（非持久实体） */
export interface ValidationProfile {
  checks: Record<CommandKind, { command?: string; required: boolean }>;
  /** 单命令超时 */
  timeoutMs: number;
  /** 修复轮次上限（0 = 纯验证门） */
  maxReviewLoops: number;
}

export const REVIEW_VERDICTS = ['approved', 'changes_requested'] as const;
export type ReviewVerdictKind = (typeof REVIEW_VERDICTS)[number];

export interface ReviewVerdict {
  verdict: ReviewVerdictKind;
  comments: string;
  loop: number;
}

export interface ReviewRequest {
  mission: Mission;
  taskId: string;
  loop: number;
  artifact: ValidationArtifact;
  /** 头 8KB 摘录 + diffStat */
  diffExcerpt: string;
  /** 前轮意见（首轮缺省） */
  priorFeedback?: string;
}

export type ReviewOutcome =
  | { ok: true; verdict: ReviewVerdict }
  | { ok: false; code: string; detail: string };

/** 审阅者端口（AgentReviewer 为默认实现；测试可注入） */
export interface Reviewer {
  review(request: ReviewRequest): Promise<ReviewOutcome>;
}

/** 任务终态汇总（进 RunReport.reviews；处置经 taskId 与 workspaces 记录关联） */
export interface ReviewPackage {
  taskId: string;
  terminal: 'approved' | 'review_exceeded' | 'review_error';
  /** 消耗修复轮次 */
  rounds: number;
  maxReviewLoops: number;
  /** 全轮次（loop 0..n） */
  artifacts: ValidationArtifact[];
  /** 全轮次审阅（纯验证门为空） */
  verdicts: ReviewVerdict[];
  /** 末轮变更面（引用语义，不内联全文） */
  diffStat: DiffStat;
}

/** 验证输入（runner 的调用契约） */
export interface ValidationInput {
  taskId: string;
  workspace: Workspace;
  loop: number;
  runId?: string;
}

/** 验证者端口（ValidationRunner 为默认实现；测试可注入脚本化替身） */
export interface Validator {
  validate(input: ValidationInput): Promise<ValidationArtifact>;
}

export type ValidationEvent =
  | {
      type: 'task.validation.started';
      runId: string;
      taskId: string;
      loop: number;
    }
  | {
      type: 'task.validation.completed';
      runId: string;
      taskId: string;
      loop: number;
      overall: ArtifactOverall;
      checks: Array<{ kind: CheckKind; status: CheckStatus }>;
    }
  | { type: 'task.review.started'; runId: string; taskId: string; loop: number }
  | {
      type: 'task.review.completed';
      runId: string;
      taskId: string;
      loop: number;
      verdict: ReviewVerdictKind;
    }
  | {
      type: 'task.review.exceeded';
      runId: string;
      taskId: string;
      maxReviewLoops: number;
      rounds: number;
    };

/** 宪法 III 默认（单一来源；mission 可覆盖） */
export const DEFAULT_MAX_REVIEW_LOOPS = 2;
/** 单检查命令默认超时（5 分钟） */
export const DEFAULT_CHECK_TIMEOUT_MS = 300_000;
/** 审阅执行默认预算（2 分钟） */
export const DEFAULT_REVIEW_TIMEOUT_MS = 120_000;
