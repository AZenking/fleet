import path from 'node:path';

import type { FileSystemPort } from '@fleet/core';

import { searchPatterns } from '../fallback/search.js';
import { loadWikiPages, wikiRootOf } from './format.js';
import type { WikiGitPort } from './git.js';
import type { WikiHit, WikiQueryResult } from './types.js';

/**
 * wiki query 检索（research.md D6 / FR-005）：复用 M1 searchPatterns
 * （repoRoot 指向 wiki 根，rg→walk 降级链照常），查询侧为确定性规则：
 * 停用词过滤 + 分词（ASCII 词 + CJK bigram）→ 命中聚合 →
 * 标题×3 + 小节×2 + 正文行×1 排序（同分按路径字典序）。
 * 宪法 VI：无向量库、无嵌入。
 */

export class WikiMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WikiMissingError';
  }
}

export interface QueryOptions {
  repoRoot: string;
  fs: FileSystemPort;
  git?: WikiGitPort;
  maxHits?: number;
  /** 测试注入：rg 命令名（不存在 → 降级 walk） */
  rgCommand?: string;
  forceWalk?: boolean;
}

const CJK_STOPWORDS = [
  '的',
  '了',
  '在',
  '是',
  '和',
  '与',
  '及',
  '或',
  '怎么',
  '哪些',
  '什么',
  '哪里',
  '如何',
  '为什么',
  '哪个',
  '这些',
  '那些',
  '一下',
  '有没有',
];

/** 英文停用词按词边界剥离——子串剥离会误伤 investigate（in/a 是子串） */
const ASCII_STOPWORDS = [
  'the',
  'a',
  'an',
  'is',
  'are',
  'in',
  'on',
  'of',
  'to',
  'and',
  'or',
  'how',
  'what',
  'where',
  'which',
  'why',
  'does',
  'do',
];

const ASCII_STOPWORD_PATTERN = new RegExp(
  `\\b(${ASCII_STOPWORDS.join('|')})\\b`,
  'g',
);

/** 确定性分词：停用词剥离 → ASCII 词 + CJK bigram */
export function extractKeywords(question: string): string[] {
  let cleaned = question.toLowerCase();
  for (const stop of CJK_STOPWORDS) {
    cleaned = cleaned.split(stop).join(' ');
  }
  cleaned = cleaned.replace(ASCII_STOPWORD_PATTERN, ' ');
  const keywords = new Set<string>();
  for (const match of cleaned.matchAll(/[a-z0-9][a-z0-9_.-]+/g)) {
    const word = match[0];
    if (word !== undefined && word.length >= 2) {
      keywords.add(word);
    }
  }
  for (const match of cleaned.matchAll(/[\u4e00-\u9fff]+/g)) {
    const run = match[0];
    if (run === undefined) {
      continue;
    }
    if (run.length === 1) {
      keywords.add(run);
    } else {
      for (let index = 0; index + 1 < run.length; index++) {
        keywords.add(run.slice(index, index + 2));
      }
      if (run.length === 2) {
        keywords.add(run);
      }
    }
  }
  return [...keywords];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function queryWiki(
  question: string,
  options: QueryOptions,
): Promise<WikiQueryResult> {
  const startedAt = Date.now();
  const wikiRoot = wikiRootOf(options.repoRoot);
  const loaded = loadWikiPages(options.fs, wikiRoot);
  const indexPage = loaded.pages.find((page) => page.path === 'index.md');
  if (indexPage === undefined || loaded.pages.length === 0) {
    throw new WikiMissingError(
      `wiki 不存在或 index.md 缺失（${path.join(options.repoRoot, '.fleet', 'wiki')}）——先运行 fleet wiki init && fleet wiki build`,
    );
  }

  const keywords = extractKeywords(question);
  const maxHits = options.maxHits ?? 10;
  let engine: WikiQueryResult['engine'] = 'walk';
  const hitLinesByFile = new Map<string, string[]>();
  if (keywords.length > 0) {
    const outcome = await searchPatterns({
      repoRoot: wikiRoot,
      patterns: keywords.map((keyword) => escapeRegExp(keyword)),
      fs: options.fs,
      rgCommand: options.rgCommand,
      forceWalk: options.forceWalk,
      maxHits: 200,
      timeoutMs: 2000,
    });
    engine = outcome.engine;
    for (const hit of outcome.hits) {
      if (hit.filePath.startsWith('.backup/')) {
        continue;
      }
      const lines = hitLinesByFile.get(hit.filePath) ?? [];
      lines.push(hit.lineText);
      hitLinesByFile.set(hit.filePath, lines);
    }
  }

  const hits: WikiHit[] = [];
  for (const page of loaded.pages) {
    if (page.path === 'index.md') {
      continue;
    }
    const title = page.metadata.title.toLowerCase();
    const body = [
      page.generatedContent ?? '',
      page.manualBefore,
      page.manualAfter,
    ].join('\n');
    const headings = body.split('\n').filter((line) => line.startsWith('#'));

    let titleMatches = 0;
    let headingMatches = 0;
    for (const keyword of keywords) {
      if (title.includes(keyword)) {
        titleMatches += 1;
      }
      if (headings.some((heading) => heading.toLowerCase().includes(keyword))) {
        headingMatches += 1;
      }
    }
    const bodyLines = hitLinesByFile.get(page.path) ?? [];
    const score = titleMatches * 3 + headingMatches * 2 + bodyLines.length;
    if (score === 0) {
      continue;
    }
    hits.push({
      pagePath: page.path,
      section: page.section,
      title: page.metadata.title,
      snippet: snippetOf(bodyLines, headings, body),
      score,
      scoreBreakdown: {
        title: titleMatches * 3,
        heading: headingMatches * 2,
        body: bodyLines.length,
      },
    });
  }

  hits.sort(
    (a, b) => b.score - a.score || a.pagePath.localeCompare(b.pagePath),
  );

  const suggestions =
    hits.length === 0
      ? loaded.pages
          .filter((page) => page.path !== 'index.md')
          .map((page) => `${page.path} — ${page.metadata.title}`)
      : [];

  return {
    question,
    hits: hits.slice(0, maxHits),
    suggestions,
    engine,
    durationMs: Date.now() - startedAt,
  };
}

function snippetOf(
  hitLines: string[],
  headings: string[],
  body: string,
): string {
  const source =
    hitLines[0] ??
    headings[0] ??
    body.split('\n').find((line) => line.trim() !== '') ??
    '';
  const line = source.trim().replace(/^#+\s*/, '');
  return line.length > 160 ? `${line.slice(0, 160)}…` : line;
}
