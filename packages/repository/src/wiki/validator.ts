import path from 'node:path';

import type { FileSystemPort } from '@fleet/core';

import { pathExists, type LoadedWiki } from './format.js';
import { INDEX_PATH, indexLinkedPaths } from './index-writer.js';
import {
  WIKI_SECTIONS,
  type ValidationReport,
  type ValidationError,
} from './types.js';

/**
 * Wiki Validator（research.md D7 / FR-004）：
 * 1. generated 区块内的反引号路径 token → 磁盘锚定（dead_reference）
 * 2. 全文档 markdown 相对链接 → wiki 内目标存在（dead_link）
 * 3. 结构：index / 四分区 / glossary / front matter / 围栏配对
 * 人工自由文本不校验路径 token（避免误报），但链接两级均校验。
 */

export function validateWiki(
  fs: FileSystemPort,
  repoRoot: string,
  wikiRoot: string,
  loaded: LoadedWiki,
): ValidationReport {
  const errors: ValidationError[] = [];
  const pages = loaded.pages;

  for (const { path, error } of loaded.errors) {
    errors.push({ code: error.code, detail: error.detail, pagePath: path });
  }

  const indexPage = pages.find((page) => page.path === INDEX_PATH);
  if (indexPage === undefined) {
    errors.push({
      code: 'missing_index',
      detail: 'index.md 不存在——先运行 fleet wiki init / build',
    });
  }
  for (const section of WIKI_SECTIONS) {
    if (!pages.some((page) => page.section === section)) {
      errors.push({
        code: 'missing_section',
        detail: `分区 ${section}/ 无任何页面（init 建立的占位缺失）`,
      });
    }
  }
  if (!pages.some((page) => page.section === 'glossary')) {
    errors.push({
      code: 'missing_section',
      detail: 'glossary.md 缺失',
    });
  }

  if (indexPage !== undefined) {
    const linked = indexLinkedPaths(indexPage);
    for (const page of pages) {
      if (page.path !== INDEX_PATH && !linked.has(page.path)) {
        errors.push({
          code: 'index_out_of_sync',
          detail: `页面未被 index 收录：${page.path}（重新 build/update 同步导航）`,
          pagePath: page.path,
        });
      }
    }
  }

  for (const page of pages) {
    if (page.generatedContent !== undefined) {
      for (const token of extractPathTokens(page.generatedContent)) {
        if (!pathExists(fs, path.join(repoRoot, token))) {
          errors.push({
            code: 'dead_reference',
            detail: `生成内容引用的路径不存在：\`${token}\``,
            pagePath: page.path,
          });
        }
      }
    }
    const fullBody = [
      page.manualBefore,
      page.generatedContent ?? '',
      page.manualAfter,
    ].join('\n');
    const pageDir = path.dirname(path.join(wikiRoot, page.path));
    for (const target of extractLinkTargets(fullBody)) {
      if (!fs.exists(path.normalize(path.join(pageDir, target)))) {
        errors.push({
          code: 'dead_link',
          detail: `markdown 链接目标不存在：(${target})`,
          pagePath: page.path,
        });
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/** generated 区块内的路径样式 token：反引号包裹、含 /、字符集受限 */
export function extractPathTokens(content: string): string[] {
  const tokens: string[] = [];
  for (const match of content.matchAll(/`([^`\n]+)`/g)) {
    const token = match[1];
    if (
      token !== undefined &&
      token.includes('/') &&
      !token.includes(' ') &&
      /^[A-Za-z0-9._\-/]+$/.test(token) &&
      !token.startsWith('http')
    ) {
      tokens.push(token);
    }
  }
  return tokens;
}

function extractLinkTargets(body: string): string[] {
  const targets: string[] = [];
  for (const match of body.matchAll(/\]\(([^)#\s]+)(?:#[^)\s]*)?\)/g)) {
    const target = match[1];
    if (target !== undefined && !/^(https?:|mailto:)/.test(target)) {
      targets.push(target);
    }
  }
  return targets;
}
