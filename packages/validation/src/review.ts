import { createId } from '@fleet/core';
import type { RuntimeAdapter } from '@fleet/runtime';
import { REQUEST_PERMISSION_ENV } from '@fleet/runtime';

import {
  DEFAULT_REVIEW_TIMEOUT_MS,
  REVIEW_VERDICTS,
  type ReviewOutcome,
  type ReviewRequest,
  type Reviewer,
  type ReviewVerdict,
  type ReviewVerdictKind,
} from './types.js';

/**
 * AgentReviewer（research.md D6）：Wisdom 经 RuntimeAdapter 执行
 * （宪法 IV 单一接缝——Fake 脚本化裁决驱动 CI，真实 CLI 同契约）。
 * 裁决解析两级宽容（JSON → 裸词）；适配器失败或解析失败 →
 * fail-closed（审阅者缺席不放行也不假装被拒，宪法 III 保守侧）。
 */

const DIFF_EXCERPT_LIMIT = 8192;
const REQUEST_ROLE_ENV = 'FLEET_AGENT_ROLE';

export interface AgentReviewerConfig {
  adapter: RuntimeAdapter;
  /** 主仓根（READ_ONLY 角色物理范围，M8 语义） */
  repoRoot: string;
  timeoutMs?: number;
}

export class AgentReviewer implements Reviewer {
  constructor(private readonly config: AgentReviewerConfig) {}

  async review(request: ReviewRequest): Promise<ReviewOutcome> {
    const result = await this.config.adapter.execute({
      runId: createId('run_'),
      // Fake 脚本键约定：<taskId>-review（与实现步骤天然分离）
      agentId: `agent:${request.taskId}-review`,
      cwd: this.config.repoRoot,
      prompt: buildPrompt(request),
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
}

function buildPrompt(request: ReviewRequest): string {
  const failed = request.artifact.checks.filter(
    (check) => check.status === 'fail' || check.status === 'timeout',
  );
  const lines = [
    '[wisdom · READ_ONLY] 内部审阅：对以下任务变更作出裁决',
    `[Mission] ${request.missionGoal}`,
    `[任务 ${request.taskId}] 验证轮次 ${request.loop} · 结论 ${request.artifact.overall}`,
    `[验证明细] ${request.artifact.checks
      .map((check) => `${check.kind}=${check.status}`)
      .join(' ')}${
      failed.length > 0
        ? `\n[失败检查] ${failed
            .map(
              (check) => `${check.kind}: ${truncate(check.outputExcerpt, 400)}`,
            )
            .join('\n')}`
        : ''
    }`,
    `[变更面] ${request.artifact.diffStat.files} 文件 +${request.artifact.diffStat.insertions}/-${request.artifact.diffStat.deletions}`,
    `[Diff 摘录]\n${truncate(request.diffExcerpt, DIFF_EXCERPT_LIMIT)}`,
    ...(request.priorFeedback !== undefined
      ? [`[前轮审阅意见] ${request.priorFeedback}`]
      : []),
    '请输出 JSON 裁决：{"verdict":"approved"|"changes_requested","comments":"..."}',
  ];
  return lines.join('\n');
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
