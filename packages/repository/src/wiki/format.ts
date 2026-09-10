import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import type { FileSystemPort } from '@fleet/core';

import {
  WIKI_DIR,
  wikiMetadataSchema,
  wikiPageSchema,
  type PageOrigin,
  type ValidationErrorCode,
  type WikiPage,
} from './types.js';

/**
 * 磁盘格式层（contracts/wiki-format.md）：front matter 解析/序列化 +
 * generated 围栏解析/重组。origin 由围栏结构推导（research.md D1/D2）；
 * 重组只动围栏内，围栏外人工内容逐字节保留（FR-009）。
 */

export const FENCE_START = '<!-- fleet:generated -->';
export const FENCE_END = '<!-- /fleet:generated -->';

export interface FormatError {
  code: Extract<
    ValidationErrorCode,
    'bad_frontmatter' | 'bad_metadata' | 'unpaired_fence'
  >;
  detail: string;
}

export type ParseOutcome =
  { ok: true; page: WikiPage } | { ok: false; error: FormatError };

/** 从页面路径推导分区（一级目录；根级页面按文件名） */
export function sectionOf(pagePath: string): WikiPage['section'] {
  const head = pagePath.split('/')[0] ?? '';
  switch (head) {
    case 'index.md':
      return 'index';
    case 'glossary.md':
      return 'glossary';
    case 'architecture':
    case 'domains':
    case 'infrastructure':
    case 'decisions':
      return head;
    default:
      return 'domains';
  }
}

/** 解析单个 wiki 页面原文 */
export function parseWikiFile(pagePath: string, raw: string): ParseOutcome {
  const matter = splitFrontMatter(raw);
  if (matter === undefined) {
    return {
      ok: false,
      error: {
        code: 'bad_frontmatter',
        detail: `页面必须以 --- front matter 块开头：${pagePath}`,
      },
    };
  }
  let metadataRaw: unknown;
  try {
    metadataRaw = parseYaml(matter.fmRaw);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'bad_frontmatter',
        detail: `front matter YAML 解析失败（${pagePath}）：${errorMessage(error)}`,
      },
    };
  }
  const metadata = wikiMetadataSchema.safeParse(metadataRaw);
  if (!metadata.success) {
    return {
      ok: false,
      error: {
        code: 'bad_metadata',
        detail: `front matter 字段不合法（${pagePath}）：${metadata.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      },
    };
  }

  const body = matter.body;
  const start = body.indexOf(FENCE_START);
  if (start === -1) {
    return {
      ok: true,
      page: wikiPageSchema.parse({
        path: pagePath,
        section: sectionOf(pagePath),
        metadata: metadata.data,
        manualBefore: body,
        manualAfter: '',
        origin: 'manual',
      }),
    };
  }
  const contentStart = start + FENCE_START.length;
  const end = body.indexOf(FENCE_END, contentStart);
  if (end === -1) {
    return {
      ok: false,
      error: {
        code: 'unpaired_fence',
        detail: `generated 围栏缺少结束标记（${pagePath}）`,
      },
    };
  }
  const manualBefore = body.slice(0, start);
  const generatedContent = body
    .slice(contentStart, end)
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
  const manualAfter = body.slice(end + FENCE_END.length);
  return {
    ok: true,
    page: wikiPageSchema.parse({
      path: pagePath,
      section: sectionOf(pagePath),
      metadata: metadata.data,
      generatedContent,
      manualBefore,
      manualAfter,
      origin: originOf(manualBefore, manualAfter),
    }),
  };
}

/** origin 推导：无围栏 = manual；围栏外有实质内容 = mixed；否则 generated */
function originOf(manualBefore: string, manualAfter: string): PageOrigin {
  return `${manualBefore}${manualAfter}`.trim() === '' ? 'generated' : 'mixed';
}

function splitFrontMatter(
  raw: string,
): { fmRaw: string; body: string } | undefined {
  if (!raw.startsWith('---\n')) {
    return undefined;
  }
  const end = raw.indexOf('\n---\n', 4);
  if (end === -1) {
    return undefined;
  }
  return {
    fmRaw: raw.slice(4, end),
    body: raw.slice(end + 5),
  };
}

/** 序列化 front matter（yaml 库保证引号/转义正确） */
export function renderFrontMatter(metadata: WikiPage['metadata']): string {
  const fm: Record<string, unknown> = {
    title: metadata.title,
    ...(metadata.generated_from !== undefined
      ? { generated_from: metadata.generated_from }
      : {}),
    updated_at: metadata.updated_at,
    scope: metadata.scope,
  };
  return `---\n${stringifyYaml(fm).trimEnd()}\n---\n`;
}

/** 组装页面全文：front matter + 人工区（原样）+ 围栏（如有生成内容） */
export function serializeWikiPage(page: WikiPage): string {
  if (page.generatedContent === undefined) {
    return (
      renderFrontMatter(page.metadata) + page.manualBefore + page.manualAfter
    );
  }
  return (
    renderFrontMatter(page.metadata) +
    page.manualBefore +
    FENCE_START +
    '\n' +
    page.generatedContent +
    '\n' +
    FENCE_END +
    page.manualAfter
  );
}

export interface LoadedWiki {
  pages: WikiPage[];
  errors: Array<{ path: string; error: FormatError }>;
}

/** 载入 wiki 目录下全部 .md 页面（跳过 .backup/） */
export function loadWikiPages(
  fs: FileSystemPort,
  wikiRoot: string,
): LoadedWiki {
  const pages: WikiPage[] = [];
  const errors: LoadedWiki['errors'] = [];
  // 目录探测走 listDir：MemoryFileSystem 的 exists 只认文件键
  try {
    fs.listDir(wikiRoot);
  } catch {
    return { pages, errors };
  }
  const files = collectMarkdownFiles(fs, wikiRoot, wikiRoot);
  for (const relative of files) {
    const raw = fs.readFileOptional(path.join(wikiRoot, relative));
    if (raw === undefined) {
      continue;
    }
    const outcome = parseWikiFile(relative, raw);
    if (outcome.ok) {
      pages.push(outcome.page);
    } else {
      errors.push({ path: relative, error: outcome.error });
    }
  }
  pages.sort((a, b) => a.path.localeCompare(b.path));
  return { pages, errors };
}

function collectMarkdownFiles(
  fs: FileSystemPort,
  current: string,
  root: string,
): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = fs.listDir(current);
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry === '.backup' || entry.startsWith('.')) {
      continue;
    }
    const absolute = path.join(current, entry);
    let isFile = false;
    try {
      fs.readFile(absolute);
      isFile = true;
    } catch {
      // 目录或不可读：视为目录继续下钻
    }
    if (isFile) {
      if (entry.endsWith('.md')) {
        results.push(path.relative(root, absolute));
      }
    } else {
      results.push(...collectMarkdownFiles(fs, absolute, root));
    }
  }
  return results;
}

/** scope 前缀匹配（research.md D3）：`.` = 全仓库；文件级 scope 精确相等 */
export function matchesScope(
  changedFile: string,
  scopeElement: string,
): boolean {
  const scope = scopeElement.replace(/\/+$/, '');
  if (scope === '.') {
    return true;
  }
  return changedFile === scope || changedFile.startsWith(`${scope}/`);
}

/**
 * 目录感知的存在性（MemoryFileSystem 的 exists 只认文件键；其 listDir
 * 对不存在路径返回空而非抛错——空列表视为不存在。锚定目标是内容承载
 * 路径，真实空目录的极少数假阴性可接受）。
 */
export function pathExists(fs: FileSystemPort, absolute: string): boolean {
  if (fs.exists(absolute)) {
    return true;
  }
  try {
    return fs.listDir(absolute).length > 0;
  } catch {
    return false;
  }
}

export function wikiRootOf(repoRoot: string): string {
  return path.join(repoRoot, WIKI_DIR);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
