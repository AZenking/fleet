import type { ContextPackage } from './types.js';

/**
 * 确定性渲染（research.md D4）：`[任务 <id>] <goal>` 首行（替身
 * CLI 的解析标记逐字节兼容——M8/M9 e2e 守门线）、`## <kind>` 分节。
 * unavailable 节渲染为标注行（不伪造内容）。调用方（executor /
 * reviewer）自行前置 `[role · permission]` 角色头。
 */

export function render(pkg: ContextPackage): string {
  const goal = pkg.sections.find((section) => section.kind === 'taskGoal');
  const header = goal?.unavailable
    ? `[任务 ${pkg.taskId}]`
    : `[任务 ${pkg.taskId}] ${goal?.content ?? ''}`;
  const body = pkg.sections
    .filter((section) => section.kind !== 'taskGoal')
    .map((section) => renderSection(section))
    .join('\n');
  return `${header}\n${body}`.trim();
}

function renderSection(section: ContextPackage['sections'][number]): string {
  if (section.unavailable) {
    return `## ${section.kind}\n[上游产物不可得（${section.source}）——本节缺省]`;
  }
  const prefix = section.kind === 'feedback' ? '[修复反馈] ' : '';
  return `## ${section.kind}\n${prefix}${section.content}`;
}
