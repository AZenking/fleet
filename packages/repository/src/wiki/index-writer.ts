import type { WikiPage } from './types.js';

/**
 * index.md 导航生成（contracts/wiki-format.md）：页面清单 → 层级导航。
 * index 是 generated 页（围栏包裹导航），build/update 后同步；
 * index_out_of_sync 的判定依据（存在页面未被 index 收录）。
 */

const SECTION_ORDER: Array<{ section: string; heading: string }> = [
  { section: 'architecture', heading: 'architecture' },
  { section: 'domains', heading: 'domains' },
  { section: 'infrastructure', heading: 'infrastructure' },
  { section: 'decisions', heading: 'decisions' },
  { section: 'glossary', heading: 'glossary' },
];

export const INDEX_PATH = 'index.md';

/** 导航正文（围栏内内容） */
export function renderIndexNav(pages: WikiPage[]): string {
  const lines: string[] = ['# Repository Wiki', ''];
  const navPages = pages.filter((page) => page.path !== INDEX_PATH);
  for (const { section, heading } of SECTION_ORDER) {
    const sectionPages = navPages.filter((page) => page.section === section);
    if (sectionPages.length === 0) {
      continue;
    }
    lines.push(`## ${heading}`);
    for (const page of sectionPages) {
      lines.push(`- [${page.metadata.title}](${page.path})`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

/** 从 index 正文提取已收录的页面路径（validator 的 index_out_of_sync 依据） */
export function indexLinkedPaths(indexPage: WikiPage): Set<string> {
  const body = [
    indexPage.manualBefore,
    indexPage.generatedContent ?? '',
    indexPage.manualAfter,
  ].join('\n');
  const linked = new Set<string>();
  for (const match of body.matchAll(/\]\(([^)#\s]+)(?:#[^)\s]*)?\)/g)) {
    const target = match[1];
    if (target !== undefined && !/^(https?:|mailto:)/.test(target)) {
      linked.add(target.replace(/^\.\//, ''));
    }
  }
  return linked;
}
