import { performance } from 'node:perf_hooks';
import { RealFileSystem, type FileSystemPort } from '@fleet/core';
import { CodeGraphCliAdapter } from '../codegraph/cli-adapter.js';
import type { CodeGraphAdapter } from '../codegraph/contract.js';
import { recentChangedFiles } from '../fallback/git.js';
import { searchPatterns } from '../fallback/search.js';
import { verifyAnchor } from '../fallback/source.js';
import { ExecaWikiGit } from '../wiki/git.js';
import {
  detectVerifyRisk,
  resolveMode,
  withEscalation,
  type HighRiskMatch,
} from '../evidence/rules.js';
import { resolveFindings } from '../evidence/resolver.js';
import type { AnchorConflictAttachment } from '../evidence/resolver.js';
import type {
  EffectiveMode,
  Evidence,
  EvidenceConflict,
  ModeResolution,
  RequestedMode,
} from '../evidence/types.js';
import { collectWikiEvidence } from '../evidence/wiki-source.js';
import type { WikiGitPort } from '../wiki/git.js';
import { planQuestion } from './planner.js';
import { detectHighRisk, validateSymbolHits } from './policy.js';
import type {
  FallbackReason,
  InvestigationPath,
  InvestigationResult,
  Reference,
  ReferenceOrigin,
} from './types.js';

/**
 * investigate 编排（M3 版，data-model 状态转换）：
 * plan → mode 裁决（auto/fast/verify + 高风险表）→ codegraph →
 * （verify）source 锚定 →（无引用时）search 兜底 → findings 汇编。
 * 宪法原则 I：任何 CodeGraph / wiki 故障只降级、不失败。
 */

export interface InvestigateOptions {
  repoRoot: string;
  adapter?: CodeGraphAdapter;
  fs?: FileSystemPort;
  maxRefs?: number;
  includeGenerated?: boolean;
  /** 调查模式（M3 FR-004）：auto 默认（高风险 → verify）；fast 不豁免高风险 */
  mode?: RequestedMode;
  /** wiki stale 判定用的 git（测试可注入假实现；缺省 ExecaWikiGit） */
  wikiGit?: WikiGitPort;
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
    // codegraph 候选默认未复核；verify 锚定后置 true（fast 保持 false）
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
  const pathsUsed = new Set<InvestigationPath>();
  let searchEngine: 'ripgrep' | 'walk' | undefined;

  const plan = planQuestion(question);

  // —— 模式裁决（M3：auto/fast/verify + 高风险表，FR-004/005）——
  const riskMatches: HighRiskMatch[] = detectVerifyRisk({
    keywords: plan.keywords,
    question,
  });
  // M1 引用级高风险（动态/反射/配置驱动/生成代码）并入模式裁决：
  // 语义保留——fast 不豁免，与 M1 的强制源码复核一致
  if (detectHighRisk({ keywords: plan.keywords })) {
    riskMatches.push({
      rule: 'dynamic_pattern',
      detail: '命中 M1 高风险模式（动态/反射/配置驱动/生成代码）',
    });
  }
  let mode = resolveMode(options.mode ?? 'auto', riskMatches);

  // —— wiki 阶段（M3：首个加速源，宪法 I 三态降级，FR-006）——
  const wiki = await collectWikiEvidence(question, {
    repoRoot: options.repoRoot,
    fs,
    git: options.wikiGit ?? new ExecaWikiGit(),
    forceWalk: options.forceWalkSearch,
  });
  let wikiEvidence: Evidence[] = [];
  let wikiConflicts: EvidenceConflict[] = [];
  if (wiki.state === 'hit') {
    wikiEvidence = wiki.evidence;
    wikiConflicts = wiki.conflicts;
    pathsUsed.add('wiki');
  } else if (wiki.fallback !== undefined) {
    fallbacks.push(wiki.fallback);
  }

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

  // —— 源码锚定（Static Truth；fast 跳过强制锚定，verified 保持 false）——
  const anchorConflicts: AnchorConflictAttachment[] = [];
  const anchorAll = (refs: Reference[]): Reference[] => {
    const anchored: Reference[] = [];
    for (const reference of refs) {
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
        anchorConflicts.push({
          filePath: outcome.reference.filePath,
          symbol: outcome.reference.symbol,
          conflict: {
            kind: 'anchor_offset',
            accelerated: {
              source: 'codegraph',
              location: `${reference.filePath}:${reference.startLine}`,
              claim: `${reference.symbol ?? '符号'} 位于第 ${reference.startLine} 行（codegraph）`,
            },
            truth: {
              location: `${outcome.reference.filePath}:${outcome.reference.startLine}`,
              fact:
                outcome.reference.snippet.split('\n')[0]?.trim() ??
                `${reference.symbol ?? '符号'} 实际位置`,
            },
            winner: 'static_truth',
            reason: '锚点与源码不一致，已按源码修正（static_truth_wins）',
          },
        });
      }
      anchored.push(outcome.reference);
    }
    return anchored;
  };

  let anchored: Reference[] = candidates;
  if (mode.effectiveMode === 'verify') {
    anchored = anchorAll(candidates);
  }

  // —— 引用级高风险（M1 语义保留）：fast 命中则事后升级并补锚定 ——
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
    if (mode.effectiveMode === 'fast') {
      mode = withEscalation(
        mode,
        'high_risk',
        '引用级高风险命中（M1 表：动态/反射/配置驱动/生成代码），升级 VERIFY 并补源码锚定',
      );
      anchored = anchorAll(candidates);
    }
    pathsUsed.add('source');
    if (codegraphUsable) {
      fallbacks.push({
        code: 'high_risk',
        detail: '命中高风险模式（动态/反射/配置驱动/生成代码），已强制源码复核',
      });
    }
  }

  // —— 搜索兜底：无源码引用时（search → source 链）——
  // verify 模式即使有 wiki 命中也继续全链取证；fast 有加速证据即免
  const finalRefs = anchored;
  const needsSearch =
    anchored.length === 0 &&
    (plan.keywords.length > 0 || plan.symbols.length > 0) &&
    (mode.effectiveMode === 'verify' || wikiEvidence.length === 0);
  if (needsSearch) {
    // FR-008：fast 下加速源零命中/不可用 → 自动走 VERIFY 底层链
    if (mode.effectiveMode === 'fast') {
      mode =
        codegraphUsable || wiki.state === 'hit'
          ? withEscalation(
              mode,
              'zero_hits',
              '加速源零命中，自动走 VERIFY 全链',
            )
          : withEscalation(
              mode,
              'accelerators_unavailable',
              '加速源不可用（CodeGraph / wiki 均未就绪），自动走 VERIFY 全链',
            );
    }
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
    // 字典序兜底：rg 并行遍历的命中顺序不稳定（M3 走查发现），
    // 无此兜底时 maxRefs 截断会造成同命令两次运行的结果集漂移
    return (
      recentScore(a) - recentScore(b) ||
      originScore(a) - originScore(b) ||
      a.filePath.localeCompare(b.filePath) ||
      a.startLine - b.startLine
    );
  });
  const references = deduped.slice(0, maxRefs);

  // —— findings 汇编（M3：确定性模板，research.md D1）——
  const findings = resolveFindings({
    symbols: plan.symbols,
    references,
    wikiEvidence,
    wikiConflicts,
    anchorConflicts,
    mode: mode.effectiveMode,
  });

  const durationMs = Math.round(performance.now() - start);
  // wiki_missing 是可选层的常态（从未构建），不是本次调查的质量受损——
  // 记录但不计入 degraded，避免信号贬值；stale/broken 仍算降级
  const degraded = fallbacks.some((reason) => reason.code !== 'wiki_missing');
  const codes = [...new Set(fallbacks.map((reason) => reason.code))];
  const summary =
    references.length === 0 && findings.every((f) => f.kind === 'insufficient')
      ? '未找到相关内容'
      : `${references.length} 处引用，${findings.length} 条结论${degraded ? `，${fallbacks.length} 次降级（${codes.join('/')}）` : ''} · ${durationMs}ms`;

  return {
    question,
    references,
    pathsUsed: [...pathsUsed],
    fallbacks,
    durationMs,
    summary,
    degraded,
    searchEngine,
    findings,
    mode,
  };
}

export type { EffectiveMode, ModeResolution };
