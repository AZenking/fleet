import { performance } from 'node:perf_hooks';
import { RealFileSystem, type FileSystemPort } from '@fleet/core';
import { CodeGraphCliAdapter } from '../codegraph/cli-adapter.js';
import type { CodeGraphAdapter } from '../codegraph/contract.js';
import { recentChangedFiles } from '../fallback/git.js';
import { searchPatterns } from '../fallback/search.js';
import { verifyAnchor } from '../fallback/source.js';
import { planQuestion } from './planner.js';
import { detectHighRisk, validateSymbolHits } from './policy.js';
import type {
  FallbackReason,
  InvestigationResult,
  Reference,
  ReferenceOrigin,
} from './types.js';

/**
 * investigate 编排（data-model 状态转换）：
 * plan → health → symbol/relations → policy.validate → source 锚定
 *      →（需要时）search → 汇总。
 * 宪法原则 I：任何 CodeGraph 故障只降级、不失败。
 */

export interface InvestigateOptions {
  repoRoot: string;
  adapter?: CodeGraphAdapter;
  fs?: FileSystemPort;
  maxRefs?: number;
  includeGenerated?: boolean;
  /** 测试确定性：禁用 rg，直接内置遍历（不算 degraded） */
  forceWalkSearch?: boolean;
}

/** 引用级高风险检测对代码与配置文件生效，仅排除纯文档 */
const DOCUMENT_FILE_PATTERN = /\.(md|markdown|txt|rst|adoc)$/i;

function toReference(
  input: {
    filePath: string;
    startLine: number;
    endLine?: number;
    symbol?: string;
    kind?: string;
    snippet?: string;
  },
  origin: ReferenceOrigin,
): Reference {
  return {
    filePath: input.filePath,
    startLine: input.startLine,
    endLine: input.endLine ?? input.startLine,
    symbol: input.symbol,
    kind: input.kind,
    snippet: input.snippet ?? '',
    origin,
    verified: origin !== 'codegraph',
  };
}

export async function investigate(
  question: string,
  options: InvestigateOptions,
): Promise<InvestigationResult> {
  const start = performance.now();
  const fs = options.fs ?? new RealFileSystem();
  const adapter =
    options.adapter ?? new CodeGraphCliAdapter({ repoRoot: options.repoRoot });
  const maxRefs = options.maxRefs ?? 20;
  const fallbacks: FallbackReason[] = [];
  const pathsUsed = new Set<ReferenceOrigin>();
  let searchEngine: 'ripgrep' | 'walk' | undefined;

  const plan = planQuestion(question);

  // —— CodeGraph 阶段 ——
  const health = await adapter.health();
  let codegraphUsable = false;
  if (!health.available) {
    fallbacks.push({
      code: 'unavailable',
      detail: 'CodeGraph 不可用（未安装或不可执行）',
      fixSuggestion: '安装 CodeGraph 可加速调查，但不是必需',
    });
  } else if (!health.initialized) {
    fallbacks.push({
      code: 'stale',
      detail: '仓库未建立 CodeGraph 索引',
      fixSuggestion: '可运行 codegraph init 建立索引（Fleet 不会代为执行）',
    });
  } else if (!health.indexFresh) {
    fallbacks.push({
      code: 'stale',
      detail: `索引过期：${health.pendingChanges} 个文件比索引新`,
      fixSuggestion: '可运行 codegraph sync 更新索引（Fleet 不会代为执行）',
    });
  } else {
    codegraphUsable = true;
  }

  const candidates: Reference[] = [];
  if (codegraphUsable) {
    pathsUsed.add('codegraph');
    for (const symbol of plan.symbols) {
      const result = await adapter.symbol(symbol);
      if (!result.ok) {
        fallbacks.push({
          code: result.failure.code,
          detail: `符号查询失败（${symbol}）：${result.failure.detail}`,
        });
        continue;
      }
      const verdict = validateSymbolHits(result.value, symbol);
      if (verdict.action === 'escalate') {
        fallbacks.push(verdict.reason);
      }
      const exact = result.value.filter((hit) => hit.name === symbol);
      for (const hit of exact) {
        candidates.push(
          toReference(
            {
              filePath: hit.filePath,
              startLine: hit.startLine,
              endLine: hit.endLine,
              symbol: hit.name,
              kind: hit.kind,
            },
            'codegraph',
          ),
        );
      }
      if (exact.length === 1) {
        const callers = await adapter.callers(symbol);
        if (callers.ok) {
          for (const edge of callers.value.slice(0, 5)) {
            candidates.push(
              toReference(
                {
                  filePath: edge.filePath,
                  startLine: edge.startLine,
                  symbol: edge.name,
                  kind: edge.kind,
                },
                'codegraph',
              ),
            );
          }
        }
      }
    }
    if (plan.keywords.length > 0) {
      const keywordQuery = plan.keywords.slice(0, 3).join(' ');
      const searched = await adapter.search(keywordQuery, 10);
      if (searched.ok) {
        for (const hit of searched.value) {
          candidates.push(
            toReference(
              {
                filePath: hit.filePath,
                startLine: hit.startLine,
                endLine: hit.endLine,
                symbol: hit.name,
                kind: hit.kind,
              },
              'codegraph',
            ),
          );
        }
      }
    }
  }

  // —— 源码锚定（Static Truth）——
  const anchored: Reference[] = [];
  for (const reference of candidates) {
    if (reference.origin !== 'codegraph') {
      anchored.push(reference);
      continue;
    }
    pathsUsed.add('source');
    const outcome = verifyAnchor(fs, options.repoRoot, reference);
    if (outcome === undefined) {
      fallbacks.push({
        code: 'conflict',
        detail: `锚点校验失败：${reference.filePath}:${reference.startLine}（文件缺失或符号不在附近）`,
      });
      continue;
    }
    if (outcome.conflict) {
      fallbacks.push({
        code: 'conflict',
        detail: `${reference.filePath}:${reference.startLine} 与源码不一致，已按源码修正`,
      });
    }
    anchored.push(outcome.reference);
  }

  // —— 高风险升级（FR-007：即使 CodeGraph 已给出结果）——
  // 引用级检测对代码与配置文件生效，纯文档不触发（文档里提到
  // "生成代码"等词不是代码声明）
  const highRisk =
    detectHighRisk({ keywords: plan.keywords }) ||
    anchored.some(
      (reference) =>
        !DOCUMENT_FILE_PATTERN.test(reference.filePath) &&
        detectHighRisk({
          filePath: reference.filePath,
          snippet: reference.snippet,
        }),
    );
  if (highRisk) {
    pathsUsed.add('source');
    if (codegraphUsable) {
      fallbacks.push({
        code: 'high_risk',
        detail: '命中高风险模式（动态/反射/配置驱动/生成代码），已强制源码复核',
      });
    }
  }

  // —— 搜索兜底：无引用时（search → source 链）——
  const finalRefs = anchored;
  const needsSearch =
    anchored.length === 0 &&
    (plan.keywords.length > 0 || plan.symbols.length > 0);
  if (needsSearch) {
    pathsUsed.add('search');
    pathsUsed.add('source');
    const outcome = await searchPatterns({
      repoRoot: options.repoRoot,
      patterns: [...plan.symbols, ...plan.keywords],
      fs,
      includeGenerated: options.includeGenerated,
      forceWalk: options.forceWalkSearch,
    });
    searchEngine = outcome.engine;
    if (outcome.degraded) {
      fallbacks.push({
        code: 'error',
        detail: '原生搜索工具不可用，已降级为内置文件遍历',
      });
    }
    for (const hit of outcome.hits) {
      finalRefs.push(
        toReference(
          {
            filePath: hit.filePath,
            startLine: hit.lineNumber,
            snippet: hit.lineText,
          },
          'search',
        ),
      );
    }
    if (outcome.hits.length === 0) {
      fallbacks.push({ code: 'empty', detail: '未找到与问题相关的内容' });
    }
  }

  // —— 去重、排序、截断 ——
  const seen = new Set<string>();
  const deduped: Reference[] = [];
  for (const reference of finalRefs) {
    const key = `${reference.filePath}:${reference.startLine}:${reference.symbol ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(reference);
    }
  }
  const recent = new Set(await recentChangedFiles(options.repoRoot));
  deduped.sort((a, b) => {
    const recentScore = (reference: Reference): number =>
      recent.has(reference.filePath) ? 0 : 1;
    const originScore = (reference: Reference): number =>
      reference.origin === 'codegraph' ? 0 : 1;
    return recentScore(a) - recentScore(b) || originScore(a) - originScore(b);
  });
  const references = deduped.slice(0, maxRefs);

  const durationMs = Math.round(performance.now() - start);
  const degraded = fallbacks.length > 0;
  const codes = [...new Set(fallbacks.map((reason) => reason.code))];
  const summary =
    references.length === 0
      ? '未找到相关内容'
      : `${references.length} 处引用${degraded ? `，${fallbacks.length} 次降级（${codes.join('/')}）` : ''} · ${durationMs}ms`;

  return {
    question,
    references,
    pathsUsed: [...pathsUsed],
    fallbacks,
    durationMs,
    summary,
    degraded,
    searchEngine,
  };
}
