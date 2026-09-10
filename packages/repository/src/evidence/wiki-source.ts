import path from 'node:path';

import type { FileSystemPort } from '@fleet/core';

import type { FallbackReason } from '../investigation/types.js';
import { loadWikiPages, pathExists, wikiRootOf } from '../wiki/format.js';
import type { WikiGitPort } from '../wiki/git.js';
import { queryWiki } from '../wiki/query.js';
import { extractPathTokens } from '../wiki/validator.js';
import type { Evidence, EvidenceConflict } from './types.js';

/**
 * wiki 证据源（research.md D4 / FR-006）：包装 M2 queryWiki。
 * 三态降级——missing / broken / stale 只记 FallbackReason，不影响
 * 调查成败（宪法 I）；stale 不使用（过期知识不冒充，与 codegraph
 * stale 语义对齐）。死路径冲突（D7）：命中页 generated 区块的路径
 * token 不存在于磁盘 → dead_path，胜出方 static_truth。
 */

export interface WikiSourceOutcome {
  state: 'hit' | 'missing' | 'stale' | 'broken';
  evidence: Evidence[];
  conflicts: EvidenceConflict[];
  fallback?: FallbackReason;
}

export interface WikiSourceOptions {
  repoRoot: string;
  fs: FileSystemPort;
  git?: WikiGitPort;
  rgCommand?: string;
  forceWalk?: boolean;
  /** wiki 证据页数上限（默认 5） */
  maxPages?: number;
}

export async function collectWikiEvidence(
  question: string,
  options: WikiSourceOptions,
): Promise<WikiSourceOutcome> {
  const empty: WikiSourceOutcome = {
    state: 'missing',
    evidence: [],
    conflicts: [],
  };
  const wikiRoot = wikiRootOf(options.repoRoot);
  const loaded = loadWikiPages(options.fs, wikiRoot);
  // broken 先于 missing：损坏的 index 同时不满足"可解析 index"，
  // 归入 broken（可用 build 修复）比 missing（从未构建）更准确
  if (loaded.errors.length > 0) {
    const first = loaded.errors[0]!;
    return {
      ...empty,
      state: 'broken',
      fallback: {
        code: 'wiki_broken',
        detail: `wiki 结构损坏（${first.path}：${first.error.code}）——可运行 fleet wiki build 重建`,
      },
    };
  }
  const indexPage = loaded.pages.find((page) => page.path === 'index.md');
  if (indexPage === undefined) {
    return {
      ...empty,
      fallback: {
        code: 'wiki_missing',
        detail:
          'wiki 未构建——可运行 fleet wiki init && fleet wiki build 加速调查（不是必需）',
      },
    };
  }

  // stale：git HEAD ≠ index 锚点 → 不使用（git 不可判定时视为可用）
  const anchor = indexPage.metadata.generated_from;
  if (anchor !== undefined && options.git !== undefined) {
    const head = await options.git.headSha(options.repoRoot);
    if (head.ok && head.value !== anchor) {
      return {
        ...empty,
        state: 'stale',
        fallback: {
          code: 'wiki_stale',
          detail: `wiki 已过期（锚点 ${anchor.slice(0, 8)} ≠ HEAD ${head.value.slice(0, 8)}），未使用——可运行 fleet wiki update`,
        },
      };
    }
  }

  try {
    const queried = await queryWiki(question, {
      repoRoot: options.repoRoot,
      fs: options.fs,
      git: options.git,
      rgCommand: options.rgCommand,
      forceWalk: options.forceWalk,
    });
    const maxPages = options.maxPages ?? 5;
    const evidence: Evidence[] = queried.hits.map((hit) => ({
      source: 'wiki' as const,
      location: hit.pagePath,
      excerpt: hit.snippet,
      verified: options.fs.exists(path.join(wikiRoot, hit.pagePath)),
    }));
    const conflicts = detectDeadPaths(
      options.fs,
      options.repoRoot,
      loaded,
      queried.hits.map((hit) => hit.pagePath),
    );
    return {
      state: 'hit',
      evidence: evidence.slice(0, maxPages),
      conflicts,
    };
  } catch (error) {
    return {
      ...empty,
      state: 'broken',
      fallback: {
        code: 'wiki_broken',
        detail: `wiki 检索失败：${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
}

/** 命中页 generated 区块的路径 token 逐一锚定磁盘（research.md D7） */
function detectDeadPaths(
  fs: FileSystemPort,
  repoRoot: string,
  loaded: ReturnType<typeof loadWikiPages>,
  hitPages: string[],
): EvidenceConflict[] {
  const conflicts: EvidenceConflict[] = [];
  const seen = new Set<string>();
  for (const pagePath of hitPages) {
    const page = loaded.pages.find((candidate) => candidate.path === pagePath);
    if (page?.generatedContent === undefined) {
      continue;
    }
    for (const token of extractPathTokens(page.generatedContent)) {
      const key = `${pagePath}:${token}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      if (!pathExists(fs, path.join(repoRoot, token))) {
        conflicts.push({
          kind: 'dead_path',
          accelerated: {
            source: 'wiki',
            location: pagePath,
            claim: `wiki 称存在 \`${token}\``,
          },
          truth: {
            location: `（磁盘）${token}`,
            fact: '该路径不存在（以仓库为准）',
          },
          winner: 'static_truth',
          reason: 'wiki 引用的路径不存在（static_truth_wins）',
        });
      }
    }
  }
  return conflicts;
}
