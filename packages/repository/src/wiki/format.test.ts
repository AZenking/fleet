import { describe, expect, it } from 'vitest';

import { MemoryFileSystem } from '@fleet/core';

import {
  FENCE_END,
  FENCE_START,
  loadWikiPages,
  matchesScope,
  parseWikiFile,
  serializeWikiPage,
} from './format.js';

/**
 * 格式层单元测试（tasks.md T006）：front matter 往返、围栏配对、
 * origin 三态、重组后人工区逐字节保留（FR-009 的机制证明）。
 */

const GENERATED_PAGE = [
  '---',
  'title: core（共享基础能力）',
  'generated_from: e0446531a2c',
  'updated_at: 2026-09-10T12:00:00.000Z',
  'scope:',
  '  - packages/core',
  '---',
  '',
  FENCE_START,
  '- 模块清单（来自 `packages/core/src/index.ts`）',
  FENCE_END,
  '',
].join('\n');

describe('parseWikiFile', () => {
  it('generated 页：围栏内容与元数据解析正确', () => {
    const outcome = parseWikiFile('domains/core.md', GENERATED_PAGE);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.page.origin).toBe('generated');
    expect(outcome.page.section).toBe('domains');
    expect(outcome.page.metadata.generated_from).toBe('e0446531a2c');
    expect(outcome.page.metadata.scope).toEqual(['packages/core']);
    expect(outcome.page.generatedContent).toContain(
      'packages/core/src/index.ts',
    );
    expect(outcome.page.manualBefore.trim()).toBe('');
    expect(outcome.page.manualAfter.trim()).toBe('');
  });

  it('mixed 页：围栏外人工内容保留在前/后段', () => {
    const raw = [
      '---',
      'title: core',
      'updated_at: 2026-09-10T12:00:00.000Z',
      'scope:',
      '  - packages/core',
      '---',
      '',
      '人工前言：这一段是维护者手写。',
      '',
      FENCE_START,
      '生成内容',
      FENCE_END,
      '',
      '人工后记：同样手写。',
      '',
    ].join('\n');
    const outcome = parseWikiFile('domains/core.md', raw);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.page.origin).toBe('mixed');
    expect(outcome.page.manualBefore).toContain('人工前言');
    expect(outcome.page.manualAfter).toContain('人工后记');
    expect(outcome.page.metadata.generated_from).toBeUndefined();
  });

  it('manual 页：无围栏 → manual', () => {
    const raw = [
      '---',
      'title: 手记',
      'updated_at: 2026-09-10T12:00:00.000Z',
      'scope:',
      '  - docs',
      '---',
      '',
      '纯人工内容，无围栏。',
      '',
    ].join('\n');
    const outcome = parseWikiFile('decisions/手记.md', raw);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.page.origin).toBe('manual');
    expect(outcome.page.generatedContent).toBeUndefined();
    expect(outcome.page.section).toBe('decisions');
  });

  it('未配对围栏 → unpaired_fence', () => {
    const raw = GENERATED_PAGE.replace(FENCE_END, '');
    const outcome = parseWikiFile('domains/core.md', raw);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.error.code).toBe('unpaired_fence');
  });

  it('缺 front matter → bad_frontmatter', () => {
    const outcome = parseWikiFile('domains/core.md', '# 没有元数据\n');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.error.code).toBe('bad_frontmatter');
  });

  it('元数据缺 title / scope → bad_metadata', () => {
    const raw = [
      '---',
      'updated_at: 2026-09-10T12:00:00.000Z',
      '---',
      '',
      FENCE_START,
      'x',
      FENCE_END,
      '',
    ].join('\n');
    const outcome = parseWikiFile('domains/core.md', raw);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.error.code).toBe('bad_metadata');
  });

  it('generated_from 非法（非 hex）→ bad_metadata', () => {
    const raw = GENERATED_PAGE.replace('e0446531a2c', 'not-a-sha');
    const outcome = parseWikiFile('domains/core.md', raw);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.error.code).toBe('bad_metadata');
  });
});

describe('serializeWikiPage（FR-009 机制）', () => {
  it('generated 页：parse → serialize 往返稳定', () => {
    const outcome = parseWikiFile('domains/core.md', GENERATED_PAGE);
    if (!outcome.ok) {
      throw new Error(outcome.error.detail);
    }
    expect(serializeWikiPage(outcome.page)).toBe(GENERATED_PAGE);
  });

  it('mixed 页：替换围栏内容后，人工区逐字节保留', () => {
    const raw = [
      '---',
      'title: core',
      'updated_at: 2026-09-10T12:00:00.000Z',
      'scope:',
      '  - packages/core',
      '---',
      '',
      '人工前言。',
      '',
      FENCE_START,
      '旧生成内容',
      FENCE_END,
      '',
      '人工后记。',
      '',
    ].join('\n');
    const outcome = parseWikiFile('domains/core.md', raw);
    if (!outcome.ok) {
      throw new Error(outcome.error.detail);
    }
    const page = outcome.page;
    const rewritten = serializeWikiPage({
      ...page,
      generatedContent: '新生成内容',
    });
    const reparsed = parseWikiFile('domains/core.md', rewritten);
    if (!reparsed.ok) {
      throw new Error(reparsed.error.detail);
    }
    expect(reparsed.page.manualBefore).toBe(page.manualBefore);
    expect(reparsed.page.manualAfter).toBe(page.manualAfter);
    expect(reparsed.page.generatedContent).toBe('新生成内容');
    expect(reparsed.page.origin).toBe('mixed');
  });
});

describe('matchesScope（research.md D3）', () => {
  it('前缀匹配与文件级精确匹配', () => {
    expect(matchesScope('packages/core/src/index.ts', 'packages/core')).toBe(
      true,
    );
    expect(matchesScope('packages/core', 'packages/core')).toBe(true);
    expect(matchesScope('packages/core-x/src/a.ts', 'packages/core')).toBe(
      false,
    );
    expect(matchesScope('package.json', 'package.json')).toBe(true);
    expect(matchesScope('package.json.example', 'package.json')).toBe(false);
    expect(matchesScope('anything/x', '.')).toBe(true);
  });
});

describe('loadWikiPages', () => {
  it('递归收集 .md、跳过 .backup、结构化收集解析错误', () => {
    const fs = new MemoryFileSystem();
    fs.writeFile('/wiki/domains/core.md', GENERATED_PAGE);
    fs.writeFile('/wiki/.backup/domains/core.md', GENERATED_PAGE);
    fs.writeFile('/wiki/broken.md', '没有 front matter');
    const loaded = loadWikiPages(fs, '/wiki');
    expect(loaded.pages.map((page) => page.path)).toEqual(['domains/core.md']);
    expect(loaded.errors).toHaveLength(1);
    expect(loaded.errors[0]?.error.code).toBe('bad_frontmatter');
  });
});
