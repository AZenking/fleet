import type {
  ConfidenceLevel,
  Evidence,
  EvidenceConflict,
  EffectiveMode,
} from './types.js';

/**
 * 置信度规则表（research.md D6 / FR-003）：
 * 输入可序列化、规则确定性——同输入同输出（SC-003）。
 * 优先级：未决冲突 > 全部未复核 > fast 封顶 > 多源一致 > 默认。
 */

export interface ConfidenceInput {
  evidence: Evidence[];
  conflicts: EvidenceConflict[];
  mode: EffectiveMode;
}

export interface ConfidenceOutcome {
  confidence: ConfidenceLevel;
  reason: string;
}

/**
 * "可信锚定" = verified 的 source/config/codegraph 证据：
 * codegraph 经 verifyAnchor 回读源码后即为源码背书（M1 语义）；
 * wiki 的 verified 仅指页面存在，不算 Static Truth。
 */
function hasAnchoredTruth(evidence: Evidence[]): boolean {
  return evidence.some((item) => item.source !== 'wiki' && item.verified);
}

function distinctSources(evidence: Evidence[]): number {
  return new Set(evidence.map((item) => item.source)).size;
}

export function evaluateConfidence(input: ConfidenceInput): ConfidenceOutcome {
  if (input.evidence.length === 0) {
    return { confidence: 'low', reason: 'insufficient：无可用证据' };
  }
  if (input.conflicts.length > 0) {
    return {
      confidence: 'low',
      reason: `存在 ${input.conflicts.length} 处未决冲突（static_truth 已胜出，结论需人工复核）`,
    };
  }
  if (!hasAnchoredTruth(input.evidence)) {
    return {
      confidence: 'low',
      reason: '全部证据未经源码/配置复核（无 verified 的 Static Truth 锚定）',
    };
  }
  if (input.mode === 'fast') {
    return {
      confidence: 'medium',
      reason: 'fast 模式封顶 medium（跳过强制源码复核）',
    };
  }
  if (distinctSources(input.evidence) >= 2) {
    return {
      confidence: 'high',
      reason: `verified 多源一致（${[...new Set(input.evidence.map((item) => item.source))].join('+')}），无未决冲突`,
    };
  }
  return {
    confidence: 'medium',
    reason: '单源 verified 证据（未达多源一致）',
  };
}
