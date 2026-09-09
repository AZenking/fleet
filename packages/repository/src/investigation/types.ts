import { z } from 'zod';

/**
 * 调查域实体（data-model.md §2–§4）。
 */

export const referenceOriginSchema = z.enum(['codegraph', 'search', 'source']);
export type ReferenceOrigin = z.infer<typeof referenceOriginSchema>;

export const referenceSchema = z.strictObject({
  filePath: z.string(),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  symbol: z.string().optional(),
  kind: z.string().optional(),
  snippet: z.string(),
  origin: referenceOriginSchema,
  /** 是否已锚定到真实源码（FR-008） */
  verified: z.boolean(),
});
export type Reference = z.infer<typeof referenceSchema>;

export const fallbackReasonCodeSchema = z.enum([
  'unavailable',
  'timeout',
  'error',
  'stale',
  'missing_symbol',
  'ambiguous',
  'empty',
  'conflict',
  'high_risk',
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
  pathsUsed: z.array(referenceOriginSchema),
  fallbacks: z.array(fallbackReasonSchema),
  durationMs: z.number().int().nonnegative(),
  summary: z.string(),
  degraded: z.boolean(),
  /** 原生搜索实际使用的引擎（walk = 内置遍历降级） */
  searchEngine: z.enum(['ripgrep', 'walk']).optional(),
});
export type InvestigationResult = z.infer<typeof investigationResultSchema>;
