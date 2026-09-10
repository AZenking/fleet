import { z } from 'zod';

/**
 * 证据域实体（data-model.md §1–§4）。
 *
 * Finding 的 statement 由确定性模板生成（research.md D1）；
 * confidence 由规则表推导（confidence.ts）；冲突限位置/存在性级
 * （research.md D7——语义级冲突需要 LLM，宪法 V 显式排除）。
 */

/** 九源枚举：本里程碑产出前五源，后四源为类型占位（spec Assumption） */
export const evidenceSourceSchema = z.enum([
  'wiki',
  'codegraph',
  'search',
  'source',
  'config',
  'lsp',
  'compiler',
  'test',
  'runtime',
]);
export type EvidenceSource = z.infer<typeof evidenceSourceSchema>;

export const evidenceSchema = z.strictObject({
  source: evidenceSourceSchema,
  /** source/config：文件路径:行；wiki：wiki 页面路径 */
  location: z.string(),
  /** ≤5 行片段（截断标注） */
  excerpt: z.string(),
  /**
   * 锚定复核结果：source/config 经 verifyAnchor 复核为 true；
   * fast 模式加速源证据为 false（快速不冒充确凿）；
   * wiki = 页面存在于磁盘
   */
  verified: z.boolean(),
  symbol: z.string().optional(),
});
export type Evidence = z.infer<typeof evidenceSchema>;

export const conflictKindSchema = z.enum(['anchor_offset', 'dead_path']);
export type ConflictKind = z.infer<typeof conflictKindSchema>;

export const evidenceConflictSchema = z.strictObject({
  kind: conflictKindSchema,
  /** 加速源陈述（败方，留痕不删除） */
  accelerated: z.strictObject({
    source: z.enum(['wiki', 'codegraph']),
    location: z.string(),
    claim: z.string(),
  }),
  /** Static Truth 事实（胜方） */
  truth: z.strictObject({
    location: z.string(),
    fact: z.string(),
  }),
  winner: z.literal('static_truth'),
  reason: z.string(),
});
export type EvidenceConflict = z.infer<typeof evidenceConflictSchema>;

export const findingKindSchema = z.enum([
  'symbol',
  'file-cluster',
  'wiki',
  'insufficient',
]);
export type FindingKind = z.infer<typeof findingKindSchema>;

export const confidenceLevelSchema = z.enum(['high', 'medium', 'low']);
export type ConfidenceLevel = z.infer<typeof confidenceLevelSchema>;

export const findingSchema = z.strictObject({
  kind: findingKindSchema,
  statement: z.string(),
  /** 1..MAX（insufficient finding 为空数组）；超限截断标注 truncated */
  evidence: z.array(evidenceSchema),
  confidence: confidenceLevelSchema,
  /** 命中的规则说明（SC-003 可解释性载体） */
  confidenceReason: z.string(),
  conflicts: z.array(evidenceConflictSchema),
  truncated: z.boolean().optional(),
});
export type Finding = z.infer<typeof findingSchema>;

/** 单 finding 证据条数上限（research.md D10 / FR-010） */
export const MAX_EVIDENCE_PER_FINDING = 10;

export const requestedModeSchema = z.enum(['auto', 'fast', 'verify']);
export type RequestedMode = z.infer<typeof requestedModeSchema>;

export const effectiveModeSchema = z.enum(['fast', 'verify']);
export type EffectiveMode = z.infer<typeof effectiveModeSchema>;

export const modeEscalationRuleSchema = z.enum([
  'high_risk',
  'zero_hits',
  'accelerators_unavailable',
]);
export type ModeEscalationRule = z.infer<typeof modeEscalationRuleSchema>;

export const modeEscalationSchema = z.strictObject({
  rule: modeEscalationRuleSchema,
  detail: z.string(),
});
export type ModeEscalation = z.infer<typeof modeEscalationSchema>;

export const modeResolutionSchema = z.strictObject({
  requestedMode: requestedModeSchema,
  effectiveMode: effectiveModeSchema,
  escalations: z.array(modeEscalationSchema),
});
export type ModeResolution = z.infer<typeof modeResolutionSchema>;
