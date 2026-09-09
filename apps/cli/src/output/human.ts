import type { CheckStatus, DiagnosticReport } from '@fleet/core';

/**
 * 人类可读渲染（contracts/cli.md 示例布局）。
 */

const SYMBOLS: Record<CheckStatus, string> = {
  ok: '✓',
  warning: '⚠',
  error: '✗',
};

export function renderHuman(report: DiagnosticReport): string {
  const lines: string[] = [];
  for (const check of report.checks) {
    lines.push(
      `${SYMBOLS[check.status]} ${check.id.padEnd(16)} ${check.detail}`,
    );
    if (check.status !== 'ok' && check.fixSuggestion) {
      lines.push(`    建议：${check.fixSuggestion}`);
    }
  }
  lines.push('─'.repeat(38));
  lines.push(report.summary);
  return lines.join('\n');
}
