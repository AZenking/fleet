import type { FileSystemPort } from '@fleet/core';

import { loadWikiPages, wikiRootOf } from './format.js';
import type { WikiGitPort } from './git.js';
import {
  refreshAnchorOnly,
  syncIndexPage,
  writeSpecPage,
  type WriteCounters,
} from './generator/build.js';
import { scanRepo, skeletonSpecs } from './generator/skeleton.js';
import { computeWikiStatus } from './status.js';
import type { UpdateResult, WikiPage } from './types.js';
import { validateWiki } from './validator.js';
import { WikiMissingError } from './query.js';

/**
 * fleet wiki update 增量更新（FR-008/009，SC-003 主载体）：
 * status 判定受影响页 → 按 origin 分派——
 * - generated/mixed 且有 spec：重算（mixed 备份 + 围栏外逐字节保留）
 * - generated/mixed 无 spec：仅刷新锚点
 * - manual：跳过并提示
 * 未受影响页面零触碰（不是 unchanged 计数，是物理不触碰）。
 */

export interface UpdateOptions {
  repoRoot: string;
  fs: FileSystemPort;
  git: WikiGitPort;
  now?: () => string;
}

export async function updateWiki(
  options: UpdateOptions,
): Promise<UpdateResult> {
  const startedAt = Date.now();
  const { repoRoot, fs, git } = options;
  const now = options.now ?? (() => new Date().toISOString());
  const wikiRoot = wikiRootOf(repoRoot);

  const status = await computeWikiStatus({ repoRoot, fs, git });
  if (!status.exists) {
    throw new WikiMissingError(
      `wiki 不存在（${wikiRoot}）——先运行 fleet wiki init && fleet wiki build`,
    );
  }

  const counters: WriteCounters = {
    pagesWritten: [],
    pagesUnchanged: [],
    pagesSkipped: [],
    backups: [],
  };

  let note: string | undefined;
  if (status.state === 'unknown') {
    note =
      '无法判定锚点（非 git 仓库或 index 缺 generated_from）——本次为无操作，建议 fleet wiki build';
    return finalize(repoRoot, fs, wikiRoot, counters, startedAt, note);
  }

  const loaded = loadWikiPages(fs, wikiRoot);
  const pagesByPath = new Map<string, WikiPage>(
    loaded.pages.map((page) => [page.path, page]),
  );
  const specsByPath = new Map(
    [...scanRepo(fs, repoRoot).specs, ...skeletonSpecs()].map((spec) => [
      spec.path,
      spec,
    ]),
  );

  const touchedSpecPaths = new Set<string>();
  for (const freshness of status.pages) {
    if (!freshness.stale) {
      continue;
    }
    const page = pagesByPath.get(freshness.path);
    if (page === undefined) {
      continue;
    }
    if (page.origin === 'manual') {
      counters.pagesSkipped.push(page.path);
      continue;
    }
    const spec = specsByPath.get(page.path);
    if (spec !== undefined) {
      touchedSpecPaths.add(spec.path);
      writeSpecPage(
        fs,
        wikiRoot,
        spec,
        page,
        status.headSha,
        now,
        false,
        counters,
      );
    } else {
      refreshAnchorOnly(fs, wikiRoot, page, status.headSha, now, counters);
    }
  }

  // 未受影响的 spec 页显式记入 unchanged（用户可核对全量分摊）
  for (const specPath of specsByPath.keys()) {
    if (
      !touchedSpecPaths.has(specPath) &&
      pagesByPath.has(specPath) &&
      pagesByPath.get(specPath)?.origin !== 'manual'
    ) {
      counters.pagesUnchanged.push(specPath);
    }
  }

  syncIndexPage(fs, wikiRoot, status.headSha, now, false, counters);

  if (status.fullRebuildRecommended) {
    note = `受影响 generated 页占比 > 70%——增量收益有限，建议 fleet wiki build 全量重建`;
  }

  return finalize(repoRoot, fs, wikiRoot, counters, startedAt, note);
}

function finalize(
  repoRoot: string,
  fs: FileSystemPort,
  wikiRoot: string,
  counters: WriteCounters,
  startedAt: number,
  note: string | undefined,
): UpdateResult {
  const reloaded = loadWikiPages(fs, wikiRoot);
  const validation = validateWiki(fs, repoRoot, wikiRoot, reloaded);
  return {
    pagesWritten: counters.pagesWritten,
    pagesUnchanged: counters.pagesUnchanged,
    pagesSkipped: counters.pagesSkipped,
    validation,
    backups: counters.backups,
    durationMs: Date.now() - startedAt,
    ...(note !== undefined ? { note } : {}),
  };
}
