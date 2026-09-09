import { z } from 'zod';

/**
 * DiagnosticReport — fleet doctor 的输出实体（data-model.md §2）。
 * 同一份数据驱动人类可读渲染与 --json 序列化（FR-011）。
 */

export const checkStatusSchema = z.enum(['ok', 'warning', 'error']);

export const checkItemSchema = z.strictObject({
  /** 稳定标识，如 node-version、git-repo、codegraph */
  id: z.string().min(1),
  /** 人类可读名称 */
  label: z.string().min(1),
  status: checkStatusSchema,
  detail: z.string(),
  /** status ≠ ok 时必须给出可执行建议 */
  fixSuggestion: z.string().optional(),
});

export const diagnosticReportSchema = z.strictObject({
  /** 全部检查无 error 即 ready；warning 不影响（宪法原则 I） */
  ready: z.boolean(),
  summary: z.string(),
  checks: z.array(checkItemSchema).min(1),
  durationMs: z.number().int().nonnegative(),
});

export type CheckStatus = z.infer<typeof checkStatusSchema>;
export type CheckItem = z.infer<typeof checkItemSchema>;
export type DiagnosticReport = z.infer<typeof diagnosticReportSchema>;
