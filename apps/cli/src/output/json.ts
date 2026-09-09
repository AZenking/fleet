import { diagnosticReportSchema, type DiagnosticReport } from '@fleet/core';

/**
 * --json 输出：DiagnosticReport 经 Schema 校验后序列化，
 * 字段与顺序稳定，退出码语义与文本模式一致（FR-011）。
 */

export function renderJson(report: DiagnosticReport): string {
  return JSON.stringify(diagnosticReportSchema.parse(report), null, 2);
}
