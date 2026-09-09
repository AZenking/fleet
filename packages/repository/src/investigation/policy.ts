import type { SymbolHit } from '../codegraph/contract.js';
import type { FallbackReason } from './types.js';

/**
 * 调查策略：确定性规则（FR-011）。升级决策可复现、可解释。
 */

export type PolicyVerdict =
  { action: 'accept' } | { action: 'escalate'; reason: FallbackReason };

export function validateSymbolHits(
  hits: SymbolHit[],
  symbolName: string,
): PolicyVerdict {
  const exact = hits.filter((hit) => hit.name === symbolName);
  if (exact.length === 0) {
    return {
      action: 'escalate',
      reason: {
        code: 'missing_symbol',
        detail: `CodeGraph 未找到符号：${symbolName}`,
      },
    };
  }
  if (exact.length > 1) {
    return {
      action: 'escalate',
      reason: {
        code: 'ambiguous',
        detail: `同名符号 ${exact.length} 处：${exact
          .map((hit) => `${hit.filePath}:${hit.startLine}`)
          .join('、')}（全部候选已列出）`,
      },
    };
  }
  return { action: 'accept' };
}

/** 高风险模式关键词（FR-007；命中即强制源码复核） */
export const HIGH_RISK_KEYWORDS = [
  '动态调用',
  '反射',
  '依赖注入',
  '注入',
  '装饰器',
  '框架魔法',
  '生成代码',
  '配置驱动',
  'reflect',
  'reflection',
  'dynamic',
  'invoke',
  'eval(',
  'ioc',
  'container',
  'plugin',
  'hook',
  'generated',
  'codegen',
  'config-driven',
  'framework',
  'magic',
];

export const CONFIG_EXTENSIONS = [
  '.yaml',
  '.yml',
  '.json',
  '.toml',
  '.ini',
  '.env',
];

export interface HighRiskInput {
  keywords?: string[];
  filePath?: string;
  snippet?: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 拉丁关键词按词边界匹配，避免 perf_hooks 里的 "hook" 这类误报 */
function matchesKeyword(haystack: string, keyword: string): boolean {
  if (/[\u4e00-\u9fff]/.test(keyword)) {
    return haystack.includes(keyword);
  }
  return new RegExp(`\\b${escapeRegExp(keyword)}`, 'i').test(haystack);
}

export function detectHighRisk(input: HighRiskInput): boolean {
  const haystack = [
    ...(input.keywords ?? []).map((keyword) => keyword.toLowerCase()),
    (input.snippet ?? '').toLowerCase(),
  ].join(' ');
  if (HIGH_RISK_KEYWORDS.some((keyword) => matchesKeyword(haystack, keyword))) {
    return true;
  }
  if (input.filePath !== undefined) {
    if (/(generated|__gen__|\.gen\b)/i.test(input.filePath)) {
      return true;
    }
    if (CONFIG_EXTENSIONS.some((ext) => input.filePath!.endsWith(ext))) {
      return true;
    }
  }
  if (input.snippet !== undefined && /@generated/i.test(input.snippet)) {
    return true;
  }
  return false;
}
