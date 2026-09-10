import path from 'node:path';

import type { FileSystemPort } from '@fleet/core';

import { loadWikiPages, serializeWikiPage, wikiRootOf } from '../format.js';
import type { WikiGitPort } from '../git.js';
import { INDEX_PATH, renderIndexNav } from '../index-writer.js';
import { validateWiki } from '../validator.js';
import { type BuildResult, type WikiPage } from '../types.js';
import {
  initWiki,
  scanRepo,
  skeletonSpecs,
  type PageSpec,
} from './skeleton.js';

/**
 * fleet wiki build 编排（FR-002）：
 * init 兜底 → 事实提取（仓库扫描 + 静态骨架 specs）→ 页面写入（幂等）
 * → index 同步 → 校验。
 *
 * 写入助手（writeSpecPage / syncIndexPage）与 updater 共享——增量更新
 * 与全量构建走同一条合并路径（FR-009 的保护逻辑只有一份实现）。
 */

export interface BuildOptions {
  repoRoot: string;
  fs: FileSystemPort;
  git?: WikiGitPort;
  force?: boolean;
  /** 可注入时钟（测试确定性） */
  now?: () => string;
}

export interface WriteCounters {
  pagesWritten: string[];
  pagesUnchanged: string[];
  pagesSkipped: string[];
  backups: string[];
}

export async function buildWiki(options: BuildOptions): Promise<BuildResult> {
  const startedAt = Date.now();
  const { repoRoot, fs } = options;
  const now = options.now ?? (() => new Date().toISOString());
  const wikiRoot = wikiRootOf(repoRoot);
  const force = options.force === true;

  initWiki(fs, repoRoot, wikiRoot, now);

  const headSha = await resolveHeadSha(options.git, repoRoot);
  const specs = [...scanRepo(fs, repoRoot).specs, ...skeletonSpecs()];
  const loaded = loadWikiPages(fs, wikiRoot);
  const pagesByPath = new Map<string, WikiPage>(
    loaded.pages.map((page) => [page.path, page]),
  );

  const counters: WriteCounters = {
    pagesWritten: [],
    pagesUnchanged: [],
    pagesSkipped: [],
    backups: [],
  };

  for (const spec of specs) {
    writeSpecPage(
      fs,
      wikiRoot,
      spec,
      pagesByPath.get(spec.path),
      headSha,
      now,
      force,
      counters,
    );
  }

  syncIndexPage(fs, wikiRoot, headSha, now, force, counters);

  const reloaded = loadWikiPages(fs, wikiRoot);
  const validation = validateWiki(fs, repoRoot, wikiRoot, reloaded);

  return {
    pagesWritten: counters.pagesWritten,
    pagesUnchanged: counters.pagesUnchanged,
    pagesSkipped: counters.pagesSkipped,
    validation,
    backups: counters.backups,
    durationMs: Date.now() - startedAt,
  };
}

async function resolveHeadSha(
  git: WikiGitPort | undefined,
  repoRoot: string,
): Promise<string | undefined> {
  if (git === undefined) {
    return undefined;
  }
  const head = await git.headSha(repoRoot);
  return head.ok ? head.value : undefined;
}

/**
 * 单页合并写入（build 与 update 共享）：
 * - manual 页：跳过（尊重人工内容）
 * - 内容与锚点均未变：unchanged（不触碰文件，updated_at 不动）
 * - mixed 页：围栏内重写、围栏外逐字节保留；写前备份（滚动一代）
 */
export function writeSpecPage(
  fs: FileSystemPort,
  wikiRoot: string,
  spec: PageSpec,
  existing: WikiPage | undefined,
  headSha: string | undefined,
  now: () => string,
  force: boolean,
  counters: WriteCounters,
): void {
  if (existing !== undefined && existing.origin === 'manual') {
    counters.pagesSkipped.push(spec.path);
    return;
  }
  const contentSame =
    existing !== undefined &&
    existing.generatedContent === spec.content &&
    JSON.stringify(existing.metadata.scope) === JSON.stringify(spec.scope);
  const anchorSame =
    headSha === undefined || existing?.metadata.generated_from === headSha;
  if (!force && contentSame && anchorSame && existing !== undefined) {
    counters.pagesUnchanged.push(spec.path);
    return;
  }
  if (existing !== undefined && existing.origin === 'mixed') {
    counters.backups.push(backupPage(fs, wikiRoot, existing));
  }
  const merged: WikiPage = {
    path: spec.path,
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
  fs.writeFile(path.join(wikiRoot, spec.path), serializeWikiPage(merged));
  counters.pagesWritten.push(spec.path);
}

/** index 导航同步（写入后页面全集 → index.md，同样幂等/备份） */
export function syncIndexPage(
  fs: FileSystemPort,
  wikiRoot: string,
  headSha: string | undefined,
  now: () => string,
  force: boolean,
  counters: WriteCounters,
): void {
  const loaded = loadWikiPages(fs, wikiRoot);
  const existingIndex = loaded.pages.find((page) => page.path === INDEX_PATH);
  const navContent = renderIndexNav(loaded.pages);
  const contentSame = existingIndex?.generatedContent === navContent;
  const anchorSame =
    headSha === undefined || existingIndex?.metadata.generated_from === headSha;
  if (!force && existingIndex !== undefined && contentSame && anchorSame) {
    counters.pagesUnchanged.push(INDEX_PATH);
    return;
  }
  if (existingIndex !== undefined && existingIndex.origin === 'mixed') {
    counters.backups.push(backupPage(fs, wikiRoot, existingIndex));
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

/** 无 spec 的受影响页：仅刷新锚点元数据（内容无生成来源可重算） */
export function refreshAnchorOnly(
  fs: FileSystemPort,
  wikiRoot: string,
  page: WikiPage,
  headSha: string | undefined,
  now: () => string,
  counters: WriteCounters,
): void {
  if (page.origin === 'mixed') {
    counters.backups.push(backupPage(fs, wikiRoot, page));
  }
  const refreshed: WikiPage = {
    ...page,
    metadata: {
      ...page.metadata,
      ...(headSha !== undefined ? { generated_from: headSha } : {}),
      updated_at: now(),
    },
  };
  fs.writeFile(path.join(wikiRoot, page.path), serializeWikiPage(refreshed));
  counters.pagesWritten.push(page.path);
}

function backupPage(
  fs: FileSystemPort,
  wikiRoot: string,
  page: WikiPage,
): string {
  // 备份落 wiki 相对 .backup/ 下（WIKI_BACKUP_DIR 是仓库级路径，
  // 直接 join wikiRoot 会产生双重前缀）
  const backupPath = path.join('.backup', page.path);
  fs.writeFile(path.join(wikiRoot, backupPath), serializeWikiPage(page));
  return backupPath;
}

export { initWiki, scanRepo, skeletonSpecs };
