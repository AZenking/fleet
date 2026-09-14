import { z } from 'zod';

import { findingSchema, modeResolutionSchema } from '../evidence/types.js';

/**
 * 调查域实体（data-model.md §2–§4；M3 增量见 evidence/types.ts）。
 */

export const referenceOriginSchema = z.enum(['codegraph', 'search', 'source']);
export type ReferenceOrigin = z.infer<typeof referenceOriginSchema>;

/** 调查服务过的路径（M3 增 wiki；Reference.origin 语义不变） */
export const investigationPathSchema = z.enum([
  'wiki',
  'codegraph',
  'search',
  'source',
]);
export type InvestigationPath = z.infer<typeof investigationPathSchema>;

export const referenceSchema = z.strictObject({
  filePath: z.string(),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  symbol: z.string().optional(),
  kind: z.string().optional(),
  snippet: z.string(),
  origin: referenceOriginSchema,
  /** 是否已锚定到真实源码（FR-008；fast 模式 codegraph 证据为 false） */
  verified: z.boolean(),
});
export type Reference = z.infer<typeof referenceSchema>;

export const fallbackReasonCodeSchema = z.enum([
  'unavailable',
  'uninitialized',
  'timeout',
  'error',
  'stale',
  'missing_symbol',
  'ambiguous',
  'empty',
  'conflict',
  'high_risk',
  // M3：wiki 证据源三态（research.md D4，向后兼容追加）
  'wiki_missing',
  'wiki_stale',
  'wiki_broken',
]);
export type FallbackReasonCode = z.infer<typeof fallbackReasonCodeSchema>;

export const fallbackReasonSchema = z.strictObject({
  code: fallbackReasonCodeSchema,
  detail: z.string(),
  fixSuggestion: z.string().optional(),
});
export type FallbackReason = z.infer<typeof fallbackReasonSchema>;

export const investigationResultSchema = z.strictObject({
  question: z.string(),
  references: z.array(referenceSchema),
  pathsUsed: z.array(investigationPathSchema),
  fallbacks: z.array(fallbackReasonSchema),
  durationMs: z.number().int().nonnegative(),
  summary: z.string(),
  degraded: z.boolean(),
  /** 原生搜索实际使用的引擎（walk = 内置遍历降级） */
  searchEngine: z.enum(['ripgrep', 'walk']).optional(),
  /** M3：证据化结论层（向后兼容的可选字段，旧消费者零感知） */
  findings: z.array(findingSchema).optional(),
  /** M3：模式裁决记录（auto/fast/verify + 升级原因） */
  mode: modeResolutionSchema.optional(),
});
export type InvestigationResult = z.infer<typeof investigationResultSchema>;
