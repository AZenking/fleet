import path from 'node:path';

import type { FileSystemPort } from '@fleet/core';

import { loadWikiPages, serializeWikiPage, wikiRootOf } from '../format.js';
import type { WikiGitPort } from '../git.js';
import { INDEX_PATH, renderIndexNav } from '../index-writer.js';
import { validateWiki } from '../validator.js';
import { WIKI_BACKUP_DIR, type BuildResult, type WikiPage } from '../types.js';
import { initWiki, scanRepo, type PageSpec } from './skeleton.js';

/**
 * fleet wiki build 编排（FR-002）：
 * init 兜底 → 事实提取 → 页面写入（幂等）→ index 同步 → 校验。
 *
 * 幂等语义：同 sha 且围栏内容/scope 未变 → pagesUnchanged（不触碰
 * 文件，updated_at 不动）；内容或锚点变化 → 重写并刷新元数据。
 * manual 页面（用户手写同路径）完全尊重，记 pagesSkipped。
 * mixed 页重写前备份至 .backup/（滚动一代，FR-009）。
 */

export interface BuildOptions {
  repoRoot: string;
  fs: FileSystemPort;
  git?: WikiGitPort;
  force?: boolean;
  /** 可注入时钟（测试确定性） */
  now?: () => string;
}

export async function buildWiki(options: BuildOptions): Promise<BuildResult> {
  const startedAt = Date.now();
  const { repoRoot, fs } = options;
  const now = options.now ?? (() => new Date().toISOString());
  const wikiRoot = wikiRootOf(repoRoot);
  const force = options.force === true;

  initWiki(fs, repoRoot, wikiRoot, now);

  const headOutcome = options.git
    ? await options.git.headSha(repoRoot)
    : { ok: false as const, error: '未注入 git（视为不可锚定）' };
  const headSha = headOutcome.ok ? headOutcome.value : undefined;

  const scan = scanRepo(fs, repoRoot);
  const specsByPath = new Map<string, PageSpec>(
    scan.specs.map((spec) => [spec.path, spec]),
  );

  const loaded = loadWikiPages(fs, wikiRoot);
  const pagesByPath = new Map<string, WikiPage>(
    loaded.pages.map((page) => [page.path, page]),
  );

  const pagesWritten: string[] = [];
  const pagesUnchanged: string[] = [];
  const pagesSkipped: string[] = [];
  const backups: string[] = [];

  for (const [specPath, spec] of specsByPath) {
    const existing = pagesByPath.get(specPath);
    if (existing !== undefined && existing.origin === 'manual') {
      // 用户手写了同路径页面：尊重人工内容，不生成（FR-009 精神）
      pagesSkipped.push(specPath);
      continue;
    }
    const contentSame =
      existing !== undefined &&
      existing.generatedContent === spec.content &&
      JSON.stringify(existing.metadata.scope) === JSON.stringify(spec.scope);
    const anchorSame =
      headSha === undefined || existing?.metadata.generated_from === headSha;
    if (!force && contentSame && anchorSame && existing !== undefined) {
      pagesUnchanged.push(specPath);
      continue;
    }
    if (existing !== undefined && existing.origin === 'mixed') {
      backups.push(backupPage(fs, wikiRoot, existing));
    }
    const merged: WikiPage = {
      path: specPath,
      section: spec.section,
      metadata: {
        title: spec.title,
        ...(headSha !== undefined ? { generated_from: headSha } : {}),
        updated_at: now(),
        scope: spec.scope,
      },
      generatedContent: spec.content,
      manualBefore: existing?.manualBefore ?? '\n',
      manualAfter: existing?.manualAfter ?? '\n',
      origin: existing?.origin ?? 'generated',
    };
    fs.writeFile(path.join(wikiRoot, specPath), serializeWikiPage(merged));
    pagesWritten.push(specPath);
  }

  // index 同步（以写入后的页面全集为准）
  await syncIndex(fs, wikiRoot, headSha, now, force, {
    pagesWritten,
    pagesUnchanged,
  });

  // 校验以磁盘终态为准
  const reloaded = loadWikiPages(fs, wikiRoot);
  const validation = validateWiki(fs, repoRoot, wikiRoot, reloaded);

  return {
    pagesWritten,
    pagesUnchanged,
    pagesSkipped,
    validation,
    backups,
    durationMs: Date.now() - startedAt,
  };
}

async function syncIndex(
  fs: FileSystemPort,
  wikiRoot: string,
  headSha: string | undefined,
  now: () => string,
  force: boolean,
  counters: { pagesWritten: string[]; pagesUnchanged: string[] },
): Promise<void> {
  const loaded = loadWikiPages(fs, wikiRoot);
  const navPages = loaded.pages;
  const existingIndex = navPages.find((page) => page.path === INDEX_PATH);
  const navContent = renderIndexNav(navPages);
  const contentSame = existingIndex?.generatedContent === navContent;
  const anchorSame =
    headSha === undefined || existingIndex?.metadata.generated_from === headSha;
  if (!force && existingIndex !== undefined && contentSame && anchorSame) {
    counters.pagesUnchanged.push(INDEX_PATH);
    return;
  }
  if (existingIndex !== undefined && existingIndex.origin === 'mixed') {
    // index 的围栏外人工内容同样保护（备份由调用方语义覆盖——此处
    // 轻量：index 通常无人工区；有则备份）
    fs.writeFile(
      path.join(wikiRoot, WIKI_BACKUP_DIR, INDEX_PATH),
      serializeWikiPage(existingIndex),
    );
  }
  const indexPage: WikiPage = {
    path: INDEX_PATH,
    section: 'index',
    metadata: {
      title: 'Repository Wiki',
      ...(headSha !== undefined ? { generated_from: headSha } : {}),
      updated_at: now(),
      scope: ['.'],
    },
    generatedContent: navContent,
    manualBefore: existingIndex?.manualBefore ?? '\n',
    manualAfter: existingIndex?.manualAfter ?? '\n',
    origin: existingIndex?.origin ?? 'generated',
  };
  fs.writeFile(path.join(wikiRoot, INDEX_PATH), serializeWikiPage(indexPage));
  counters.pagesWritten.push(INDEX_PATH);
}

function backupPage(
  fs: FileSystemPort,
  wikiRoot: string,
  page: WikiPage,
): string {
  const backupPath = path.join(WIKI_BACKUP_DIR, page.path);
  fs.writeFile(path.join(wikiRoot, backupPath), serializeWikiPage(page));
  return backupPath;
}

export { initWiki, scanRepo };
