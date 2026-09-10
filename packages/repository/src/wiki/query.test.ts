import { describe, expect, it } from 'vitest';

import { MemoryFileSystem } from '@fleet/core';

import { loadWikiPages } from './format.js';
import { extractKeywords, queryWiki, WikiMissingError } from './query.js';

/**
 * query 单元测试（tasks.md T016）：排序确定性、中文 bigram、空结果建议、
 * 降级与缺失语义。单元层用 forceWalk（walk 引擎走注入的 MemoryFileSystem，
 * 不触碰磁盘与真实 rg）。
 */

function wikiFs(): MemoryFileSystem {
  const fs = new MemoryFileSystem();
  const page = (
    path: string,
    title: string,
    scope: string[],
    body: string,
  ): void => {
    fs.writeFile(
      path,
      [
        '---',
        `title: ${title}`,
        'updated_at: 2026-09-10T00:00:00.000Z',
        'scope:',
        ...scope.map((entry) => `  - ${entry}`),
        '---',
        '',
        body,
        '',
      ].join('\n'),
    );
  };
  fs.writeFile(
    '/repo/.fleet/wiki/index.md',
    [
      '---',
      'title: Repository Wiki',
      'updated_at: 2026-09-10T00:00:00.000Z',
      'scope:',
      '  - .',
      '---',
      '',
      '- [仓库智能](domains/repository.md)',
      '- [核心](domains/core.md)',
      '',
    ].join('\n'),
  );
  page(
    '/repo/.fleet/wiki/domains/repository.md',
    '仓库智能',
    ['packages/repository'],
    [
      '<!-- fleet:generated -->',
      '# 仓库智能',
      '',
      '调查链路：`packages/repository/src/investigation`',
      '降级触发条件：unavailable / stale / ambiguous。',
      '<!-- /fleet:generated -->',
    ].join('\n'),
  );
  page(
    '/repo/.fleet/wiki/domains/core.md',
    '核心',
    ['packages/core'],
    [
      '<!-- fleet:generated -->',
      '# 核心',
      '',
      '共享基础：config 与 errors。',
      '<!-- /fleet:generated -->',
    ].join('\n'),
  );
  return fs;
}

describe('extractKeywords（research.md D6）', () => {
  it('中文 bigram + 英文词 + 停用词剥离', () => {
    const keywords = extractKeywords(
      'core 包提供哪些模块？How does investigate work?',
    );
    expect(keywords).toContain('core');
    expect(keywords).toContain('investigate');
    expect(keywords).toContain('work');
    expect(keywords.some((keyword) => keyword.includes('模'))).toBe(true);
    expect(keywords).not.toContain('哪些');
    expect(keywords).not.toContain('does');
  });

  it('单个汉字保留为关键词', () => {
    expect(extractKeywords('包')).toContain('包');
  });
});

describe('queryWiki', () => {
  it('命中排序：标题加权 > 小节 > 正文，同分按路径字典序（确定性）', async () => {
    const fs = wikiFs();
    const first = await queryWiki('仓库智能 investigate', {
      repoRoot: '/repo',
      fs,
      forceWalk: true,
    });
    const second = await queryWiki('仓库智能 investigate', {
      repoRoot: '/repo',
      fs,
      forceWalk: true,
    });
    expect(first.hits.map((hit) => hit.pagePath)).toEqual(
      second.hits.map((hit) => hit.pagePath),
    );
    expect(first.hits[0]?.pagePath).toBe('domains/repository.md');
    expect(first.hits[0]?.scoreBreakdown.title).toBeGreaterThan(0);
    expect(first.engine).toBe('walk');
  });

  it('中文问题经 bigram 命中', async () => {
    const result = await queryWiki('降级触发条件', {
      repoRoot: '/repo',
      fs: wikiFs(),
      forceWalk: true,
    });
    expect(result.hits.map((hit) => hit.pagePath)).toContain(
      'domains/repository.md',
    );
  });

  it('无命中：空结果 + suggestions（退出语义由 CLI 层映射）', async () => {
    const result = await queryWiki('zzz不存在的主题xyz', {
      repoRoot: '/repo',
      fs: wikiFs(),
      forceWalk: true,
    });
    expect(result.hits).toEqual([]);
    expect(result.suggestions.length).toBeGreaterThanOrEqual(2);
    expect(result.suggestions[0]).toContain('—');
  });

  it('wiki 缺失 → WikiMissingError（附修复指引）', async () => {
    const fs = new MemoryFileSystem();
    await expect(
      queryWiki('任意', { repoRoot: '/repo', fs, forceWalk: true }),
    ).rejects.toBeInstanceOf(WikiMissingError);
  });

  it('.backup/ 页面不进入结果', async () => {
    const fs = wikiFs();
    const raw = fs.readFile('/repo/.fleet/wiki/domains/core.md');
    fs.writeFile('/repo/.fleet/wiki/.backup/domains/core.md', raw);
    const result = await queryWiki('共享基础', {
      repoRoot: '/repo',
      fs,
      forceWalk: true,
    });
    expect(
      result.hits.every((hit) => !hit.pagePath.startsWith('.backup/')),
    ).toBe(true);
    expect(loadWikiPages(fs, '/repo/.fleet/wiki').pages).toHaveLength(3);
  });
});
