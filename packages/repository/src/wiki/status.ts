import type { FileSystemPort } from '@fleet/core';

import { loadWikiPages, matchesScope, wikiRootOf } from './format.js';
import type { WikiGitPort } from './git.js';
import { INDEX_PATH } from './index-writer.js';
import type { PageFreshness, WikiStatus } from './types.js';

/**
 * 页面级 stale 判定（research.md D4 / FR-007，SC-004 纯集合运算）：
 * index 页 generated_from 作为整体锚点 → git diff --name-only →
 * changed files ∩ scope（前缀匹配）→ 页面 stale；unknown = 无锚点或
 * 非 git，绝不猜测。
 */

export interface StatusOptions {
  repoRoot: string;
  fs: FileSystemPort;
  git: WikiGitPort;
}

/** 受影响 generated/mixed 页占比超过该阈值时建议全量 rebuild */
const FULL_REBUILD_RATIO = 0.7;

const MISSING_STATUS: WikiStatus = {
  exists: false,
  state: 'unknown',
  changedFiles: [],
  pages: [],
  fullRebuildRecommended: false,
};

export async function computeWikiStatus(
  options: StatusOptions,
): Promise<WikiStatus> {
  const { repoRoot, fs, git } = options;
  const wikiRoot = wikiRootOf(repoRoot);
  const loaded = loadWikiPages(fs, wikiRoot);
  const indexPage = loaded.pages.find((page) => page.path === INDEX_PATH);
  if (indexPage === undefined) {
    return MISSING_STATUS;
  }

  const head = await git.headSha(repoRoot);
  if (!head.ok) {
    return unknownStatus(loaded.pages);
  }
  const anchor = indexPage.metadata.generated_from;
  if (anchor === undefined) {
    return unknownStatus(loaded.pages);
  }

  const changed = await git.changedFiles(repoRoot, anchor);
  if (!changed.ok) {
    return unknownStatus(loaded.pages);
  }
  const ahead = await git.aheadCount(repoRoot, anchor);
  const changedFiles = changed.value;

  const pages: PageFreshness[] = loaded.pages.map((page) => {
    const matchedScope = page.metadata.scope.filter((scope) =>
      changedFiles.some((file) => matchesScope(file, scope)),
    );
    return {
      path: page.path,
      origin: page.origin,
      stale: matchedScope.length > 0,
      matchedScope,
    };
  });

  const staleGenerated = pages.filter(
    (page) => page.stale && page.origin !== 'manual',
  );
  const totalGenerated = pages.filter((page) => page.origin !== 'manual');

  return {
    exists: true,
    state: staleGenerated.length > 0 ? 'stale' : 'fresh',
    headSha: head.value,
    generatedFrom: anchor,
    aheadCommits: ahead.ok ? ahead.value : undefined,
    changedFiles,
    pages,
    fullRebuildRecommended:
      totalGenerated.length > 0 &&
      staleGenerated.length / totalGenerated.length > FULL_REBUILD_RATIO,
  };
}

function unknownStatus(
  pages: Array<{ path: string; origin: PageFreshness['origin'] }>,
): WikiStatus {
  return {
    exists: true,
    state: 'unknown',
    changedFiles: [],
    pages: pages.map((page) => ({
      path: page.path,
      origin: page.origin,
      stale: false,
      matchedScope: [],
    })),
    fullRebuildRecommended: false,
  };
}
