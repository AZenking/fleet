import { createId } from '@fleet/core';
import type { Task } from '@fleet/mission';
import type { RuntimeAdapter } from '@fleet/runtime';
import { REQUEST_PERMISSION_ENV } from '@fleet/runtime';
import { ContextBuilder, RunArtifactRegistry, render } from '@fleet/context';

import {
  DEFAULT_REVIEW_TIMEOUT_MS,
  REVIEW_VERDICTS,
  type ReviewOutcome,
  type ReviewRequest,
  type Reviewer,
  type ReviewVerdict,
  type ReviewVerdictKind,
  type ValidationArtifact,
} from './types.js';

/**
 * AgentReviewer（research.md D6 / M10 D8）：Wisdom 经 RuntimeAdapter
 * 执行（宪法 IV 单一接缝——Fake 脚本化裁决驱动 CI，真实 CLI 同
 * 契约）。M10 起上下文经 ContextBuilder（wisdom 规则）统一装配：
 * mission + validation 摘要（含失败检查节选）+ 上游 findings +
 * diff 摘录 + 前轮意见；渲染保留 M9 锚。裁决解析两级宽容
 * （JSON → 裸词）；适配器失败或解析失败 → fail-closed（审阅者
 * 缺席不放行也不假装被拒，宪法 III 保守侧）。
 */

const DIFF_EXCERPT_LIMIT = 8192;
const REQUEST_ROLE_ENV = 'FLEET_AGENT_ROLE';
const VERDICT_FORMAT_HINT =
  '请输出 JSON 裁决：{"verdict":"approved"|"changes_requested","comments":"..."}';

export interface AgentReviewerConfig {
  adapter: RuntimeAdapter;
  /** 主仓根（READ_ONLY 角色物理范围，M8 语义） */
  repoRoot: string;
  timeoutMs?: number;
  /** M10：统一装配（缺省内部构造，行为等价） */
  builder?: ContextBuilder;
  /** 上游 findings 事实源（run 集成注入；缺省空注册表） */
  registry?: RunArtifactRegistry;
}

export class AgentReviewer implements Reviewer {
  private readonly builder: ContextBuilder;

  constructor(private readonly config: AgentReviewerConfig) {
    this.builder = config.builder ?? new ContextBuilder();
  }

  async review(request: ReviewRequest): Promise<ReviewOutcome> {
    const result = await this.config.adapter.execute({
      runId: createId('run_'),
      // Fake 脚本键约定：<taskId>-review（与实现步骤天然分离）
      agentId: `agent:${request.taskId}-review`,
      cwd: this.config.repoRoot,
      prompt: this.buildPrompt(request),
      env: {
        [REQUEST_ROLE_ENV]: 'wisdom',
        [REQUEST_PERMISSION_ENV]: 'READ_ONLY',
      },
      timeoutMs: this.config.timeoutMs ?? DEFAULT_REVIEW_TIMEOUT_MS,
    });
    if (!result.ok) {
      return {
        ok: false,
        code: result.code ?? 'error',
        detail: result.detail ?? '审阅运行时执行失败',
      };
    }
    const verdict = parseVerdict(result.output ?? '');
    if (verdict === undefined) {
      return {
        ok: false,
        code: 'verdict_unparseable',
        detail: `审阅输出不可解析为裁决：${truncate(result.output ?? '', 300)}`,
      };
    }
    return {
      ok: true,
      verdict: { ...verdict, loop: request.loop },
    };
  }

  /** wisdom 规则装配 + M9 锚保留（格式说明行尾置） */
  private buildPrompt(request: ReviewRequest): string {
    const reviewTask: Task = {
      id: request.taskId,
      goal: '内部审阅：对任务变更作出裁决',
      agentRole: 'wisdom',
      dependsOn: [],
    };
    const built = this.builder.build({
      task: reviewTask,
      mission: request.mission,
      registry: this.config.registry ?? new RunArtifactRegistry(),
      suppliers: {
        validation: validationSummary(request.artifact),
        diff: truncate(request.diffExcerpt, DIFF_EXCERPT_LIMIT),
      },
      feedback:
        request.priorFeedback !== undefined
          ? `上一轮审阅意见：${request.priorFeedback}`
          : undefined,
    });
    if (!built.ok) {
      // 审阅上下文超预算——fail-closed（不放行、不静默降级装配）
      throw new Error(
        `审阅上下文超预算：${built.rejection.sections
          .map((section) => `${section.kind}=${section.sizeTokens}`)
          .join(' ')}`,
      );
    }
    return `${render(built.pkg)}\n${VERDICT_FORMAT_HINT}`;
  }
}

function validationSummary(artifact: ValidationArtifact): string {
  const failed = artifact.checks.filter(
    (check) => check.status === 'fail' || check.status === 'timeout',
  );
  return [
    `验证轮次 ${artifact.loop} · 结论 ${artifact.overall}`,
    `明细：${artifact.checks.map((check) => `${check.kind}=${check.status}`).join(' ')}`,
    ...failed.map(
      (check) =>
        `[失败 ${check.kind}${check.command !== undefined ? ` ${check.command}` : ''}] ${truncate(check.outputExcerpt, 400)}`,
    ),
  ].join('\n');
}

/** 两级宽容解析：JSON {verdict, comments} → 裸行 approved/changes_requested */
export function parseVerdict(
  output: string,
): Omit<ReviewVerdict, 'loop'> | undefined {
  const text = output.trim();
  if (text.length === 0) {
    return undefined;
  }
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    try {
      const parsed: unknown = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
      if (typeof parsed === 'object' && parsed !== null) {
        const { verdict, comments } = parsed as {
          verdict?: unknown;
          comments?: unknown;
        };
        if (isVerdict(verdict)) {
          return {
            verdict,
            comments: typeof comments === 'string' ? comments : '',
          };
        }
      }
    } catch {
      // 落入裸词匹配
    }
  }
  const bare = /^"?((?:approved)|(?:changes_requested))"?$/m.exec(text);
  if (bare !== null) {
    return { verdict: bare[1] as ReviewVerdictKind, comments: '' };
  }
  return undefined;
}

function isVerdict(value: unknown): value is ReviewVerdictKind {
  return (
    typeof value === 'string' &&
    (REVIEW_VERDICTS as readonly string[]).includes(value)
  );
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}[…已截断]`;
}
