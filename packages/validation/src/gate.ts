import type { Mission } from '@fleet/mission';
import type {
  GateDecision,
  GateEvaluation,
  WorkspaceGate,
} from '@fleet/workspace';

import type {
  ReviewPackage,
  ReviewOutcome,
  Reviewer,
  ReviewRequest,
  ValidationArtifact,
  ValidationEvent,
  ValidationProfile,
  Validator,
} from './types.js';

/**
 * ValidationReviewGate（data-model §7 状态机，research.md D2）：
 * 显式任务级循环——validate → review → reexecute（修复）→ ↯。
 * 循环不变式：rounds ≤ maxReviewLoops（上限检查先于修复发起，
 * 结构性不可能无限循环）；审阅次数 ≤ 修复次数 + 1（每轮修复必被
 * 评价）。maxReviewLoops = 0 → 纯验证门（验证通过即验收）。
 *
 * 终态结论（review_exceeded / review_error）携带 retryable=false
 * ——确定性结论重试不改判（scheduler 不重入队，research.md D3）。
 */

export interface ValidationGateConfig {
  runner: Validator;
  reviewer: Reviewer;
  profile: ValidationProfile;
  /** mission（审阅上下文装配来源，M10 统一） */
  mission: Mission;
  runId?: string;
  /** 事件出口（缺省丢弃——库层可测顺序与计数） */
  emitEvent?: (event: ValidationEvent) => void;
}

export class ValidationReviewGate implements WorkspaceGate {
  readonly packages: ReviewPackage[] = [];

  constructor(private readonly config: ValidationGateConfig) {}

  async evaluate(evaluation: GateEvaluation): Promise<GateDecision> {
    if (!evaluation.execution.ok) {
      // 首跑实现失败：M5 retry 语义（可重试），不经循环；
      // 装配期终态拒绝（context 超预算等）透传 retryable=false
      return {
        pass: false,
        outcome: 'fix_failed',
        detail: evaluation.execution.detail ?? '实现执行失败',
        ...(evaluation.execution.retryable !== undefined
          ? { retryable: evaluation.execution.retryable }
          : {}),
      };
    }

    const { task, workspace } = evaluation;
    const max = this.config.profile.maxReviewLoops;
    const runId = this.config.runId ?? 'adhoc';
    const artifacts: ValidationArtifact[] = [];
    const verdicts: ReviewPackage['verdicts'] = [];
    let rounds = 0;
    let loop = 0;
    let priorFeedback: string | undefined;

    for (;;) {
      this.emit({
        type: 'task.validation.started',
        runId,
        taskId: task.id,
        loop,
      });
      this.emit({ type: 'validation.started', runId, taskId: task.id, loop });
      const artifact = await this.config.runner.validate({
        taskId: task.id,
        workspace,
        loop,
        runId,
      });
      artifacts.push(artifact);
      this.emit({
        type: 'task.validation.completed',
        runId,
        taskId: task.id,
        loop,
        overall: artifact.overall,
        checks: artifact.checks.map((check) => ({
          kind: check.kind,
          status: check.status,
        })),
      });
      this.emit({
        type: 'validation.completed',
        runId,
        taskId: task.id,
        loop,
        overall: artifact.overall,
      });

      // 需要"再修一次"的结论：验证失败 或 审阅退回
      let feedback: string;
      if (artifact.overall === 'fail') {
        feedback = failureSummary(artifact);
      } else {
        if (max === 0) {
          return this.approved(task.id, rounds, artifacts, verdicts);
        }
        this.emit({
          type: 'task.review.started',
          runId,
          taskId: task.id,
          loop,
        });
        this.emit({ type: 'review.requested', runId, taskId: task.id, loop });
        const review = await this.config.reviewer.review(
          reviewRequest(
            this.config.mission,
            task.id,
            loop,
            artifact,
            priorFeedback,
          ),
        );
        if (!review.ok) {
          return this.reviewError(task.id, rounds, artifacts, verdicts, review);
        }
        verdicts.push(review.verdict);
        this.emit({
          type: 'task.review.completed',
          runId,
          taskId: task.id,
          loop,
          verdict: review.verdict.verdict,
        });
        this.emit({
          type:
            review.verdict.verdict === 'approved'
              ? 'review.approved'
              : 'review.changes-requested',
          runId,
          taskId: task.id,
          loop,
        });
        if (review.verdict.verdict === 'approved') {
          return this.approved(task.id, rounds, artifacts, verdicts);
        }
        feedback =
          review.verdict.comments.trim().length > 0
            ? review.verdict.comments
            : '审阅退回（changes_requested，无具体意见）';
      }

      // 上限检查先于修复发起（不变式锚点）
      if (rounds >= max) {
        this.emit({
          type: 'task.review.exceeded',
          runId,
          taskId: task.id,
          maxReviewLoops: max,
          rounds,
        });
        this.emit({
          type: 'review.exceeded',
          runId,
          taskId: task.id,
          maxReviewLoops: max,
          rounds,
        });
        const last = verdicts.at(-1);
        return this.terminal(
          'review_exceeded',
          task.id,
          rounds,
          artifacts,
          verdicts,
          {
            pass: false,
            outcome: 'review_exceeded',
            retryable: false,
            detail:
              `review_exceeded：修复轮次耗尽（${rounds}/${max}）` +
              (last !== undefined ? `；末轮审阅意见：${last.comments}` : ''),
          },
        );
      }

      rounds += 1;
      const fix = await evaluation.reexecute(feedback);
      if (!fix.ok) {
        return {
          pass: false,
          outcome: 'fix_failed',
          detail: fix.detail ?? `第 ${rounds} 轮修复执行失败`,
        };
      }
      priorFeedback = feedback;
      loop += 1;
    }
  }

  private approved(
    taskId: string,
    rounds: number,
    artifacts: ValidationArtifact[],
    verdicts: ReviewPackage['verdicts'],
  ): GateDecision {
    this.pushPackage('approved', taskId, rounds, artifacts, verdicts);
    return {
      pass: true,
      outcome: 'approved',
      detail:
        rounds === 0
          ? '验证通过 + 审阅批准（零修复）'
          : `验证通过 + 审阅批准（${rounds} 轮修复后通过）`,
    };
  }

  private reviewError(
    taskId: string,
    rounds: number,
    artifacts: ValidationArtifact[],
    verdicts: ReviewPackage['verdicts'],
    review: Extract<ReviewOutcome, { ok: false }>,
  ): GateDecision {
    this.pushPackage('review_error', taskId, rounds, artifacts, verdicts);
    return {
      pass: false,
      outcome: 'review_error',
      retryable: false,
      detail: `review_error：审阅失败（fail-closed，${review.code}）：${review.detail}`,
    };
  }

  private terminal(
    terminal: 'review_exceeded',
    taskId: string,
    rounds: number,
    artifacts: ValidationArtifact[],
    verdicts: ReviewPackage['verdicts'],
    decision: GateDecision,
  ): GateDecision {
    this.pushPackage(terminal, taskId, rounds, artifacts, verdicts);
    return decision;
  }

  private pushPackage(
    terminal: ReviewPackage['terminal'],
    taskId: string,
    rounds: number,
    artifacts: ValidationArtifact[],
    verdicts: ReviewPackage['verdicts'],
  ): void {
    const last = artifacts.at(-1);
    this.packages.push({
      taskId,
      terminal,
      rounds,
      maxReviewLoops: this.config.profile.maxReviewLoops,
      artifacts,
      verdicts,
      diffStat: last?.diffStat ?? { files: 0, insertions: 0, deletions: 0 },
    });
  }

  private emit(event: ValidationEvent): void {
    this.config.emitEvent?.(event);
  }
}

function reviewRequest(
  mission: Mission,
  taskId: string,
  loop: number,
  artifact: ValidationArtifact,
  priorFeedback: string | undefined,
): ReviewRequest {
  // diff 检查的 outputExcerpt 即变更面摘录（runner 已截断头尾）
  const diffExcerpt =
    artifact.checks.find((check) => check.kind === 'diff')?.outputExcerpt ?? '';
  return { mission, taskId, loop, artifact, diffExcerpt, priorFeedback };
}

function failureSummary(artifact: ValidationArtifact): string {
  const failed = artifact.checks.filter(
    (check) => check.status === 'fail' || check.status === 'timeout',
  );
  return [
    `第 ${artifact.loop} 轮验证未通过：`,
    ...failed.map(
      (check) =>
        `[${check.kind}${check.command !== undefined ? ` ${check.command}` : ''}${
          check.exitCode !== undefined ? ` exit=${check.exitCode}` : ''
        }] ${check.outputExcerpt.slice(0, 600)}`,
    ),
  ].join('\n');
}
