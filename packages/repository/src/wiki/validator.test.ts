import { describe, expect, it } from 'vitest';

import { MemoryFileSystem } from '@fleet/core';

import { loadWikiPages, FENCE_END, FENCE_START } from './format.js';
import { INDEX_PATH, renderIndexNav } from './index-writer.js';
import { validateWiki } from './validator.js';

/**
 * Validator 单元测试（tasks.md T013）：八类错误码矩阵（research.md D7）。
 */

function pageRaw(
  path: string,
  title: string,
  scope: string[],
  generated: string | undefined,
  extra = '',
): string {
  const fm = [
    '---',
    `title: ${title}`,
    'updated_at: 2026-09-10T00:00:00.000Z',
    'scope:',
    ...scope.map((entry) => `  - ${entry}`),
    '---',
    '',
  ].join('\n');
  if (generated === undefined) {
    return `${fm}${extra}\n`;
  }
  return `${fm}${FENCE_START}\n${generated}\n${FENCE_END}\n${extra}`;
}

/** 合法 wiki 骨架（validator 通过基线） */
function healthyWiki(): MemoryFileSystem {
  const fs = new MemoryFileSystem();
  fs.writeFile('/repo/packages/core/src/index.ts', 'export const X = 1;\n');
  const wiki = '/repo/.fleet/wiki';
  fs.writeFile(
    `${wiki}/index.md`,
    pageRaw(
      INDEX_PATH,
      'Repository Wiki',
      ['.'],
      [
        '# Repository Wiki',
        '',
        '## domains',
        '- [core](domains/core.md)',
        '- [手记](decisions/note.md)',
        '- [术语表](glossary.md)',
        '- [architecture 分区](architecture/README.md)',
        '- [domains 分区](domains/README.md)',
        '- [infrastructure 分区](infrastructure/README.md)',
        '- [decisions 分区](decisions/README.md)',
      ].join('\n'),
    ),
  );
  for (const dir of [
    'architecture',
    'domains',
    'infrastructure',
    'decisions',
  ]) {
    fs.writeFile(
      `${wiki}/${dir}/README.md`,
      pageRaw(
        `${dir}/README.md`,
        `${dir} 分区`,
        ['.'],
        undefined,
        `# ${dir}\n`,
      ),
    );
  }
  fs.writeFile(
    `${wiki}/domains/core.md`,
    pageRaw(
      'domains/core.md',
      'core',
      ['packages/core'],
      ['- 入口：`packages/core/src/index.ts`'].join('\n'),
    ),
  );
  fs.writeFile(
    `${wiki}/decisions/note.md`,
    pageRaw('decisions/note.md', '手记', ['.'], undefined, '人工决策记录。\n'),
  );
  fs.writeFile(
    `${wiki}/glossary.md`,
    pageRaw('glossary.md', '术语表', ['.'], '| 术语 | 含义 |\n|---|---|'),
  );
  return fs;
}

describe('validateWiki', () => {
  it('合法 wiki：0 错误', () => {
    const fs = healthyWiki();
    const loaded = loadWikiPages(fs, '/repo/.fleet/wiki');
    const report = validateWiki(fs, '/repo', '/repo/.fleet/wiki', loaded);
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('缺 index → missing_index', () => {
    const fs = healthyWiki();
    // MemoryFileSystem 无删除：重写为目录页使 index 解析后不存在
    const fs2 = healthyWiki();
    void fs;
    const loaded = loadWikiPages(fs2, '/repo/.fleet/wiki');
    const withoutIndex = {
      pages: loaded.pages.filter((page) => page.path !== INDEX_PATH),
      errors: loaded.errors,
    };
    const report = validateWiki(
      fs2,
      '/repo',
      '/repo/.fleet/wiki',
      withoutIndex,
    );
    expect(report.errors.map((error) => error.code)).toContain('missing_index');
  });

  it('缺分区 → missing_section', () => {
    const fs = healthyWiki();
    const loaded = loadWikiPages(fs, '/repo/.fleet/wiki');
    const withoutDomains = {
      pages: loaded.pages.filter((page) => page.section !== 'domains'),
      errors: loaded.errors,
    };
    const report = validateWiki(
      fs,
      '/repo',
      '/repo/.fleet/wiki',
      withoutDomains,
    );
    expect(report.errors.map((error) => error.code)).toContain(
      'missing_section',
    );
  });

  it('生成内容引用不存在的路径 → dead_reference', () => {
    const fs = healthyWiki();
    fs.writeFile(
      '/repo/.fleet/wiki/domains/core.md',
      pageRaw(
        'domains/core.md',
        'core',
        ['packages/core'],
        ['- 幽灵模块：`packages/ghost/src/index.ts`'].join('\n'),
      ),
    );
    const loaded = loadWikiPages(fs, '/repo/.fleet/wiki');
    const report = validateWiki(fs, '/repo', '/repo/.fleet/wiki', loaded);
    const hit = report.errors.find((error) => error.code === 'dead_reference');
    expect(hit?.detail).toContain('packages/ghost');
    expect(hit?.pagePath).toBe('domains/core.md');
  });

  it('markdown 死链 → dead_link（含人工区）', () => {
    const fs = healthyWiki();
    fs.writeFile(
      '/repo/.fleet/wiki/decisions/note.md',
      pageRaw(
        'decisions/note.md',
        '手记',
        ['.'],
        undefined,
        '详见 [幽灵页](../domains/ghost.md)。\n',
      ),
    );
    const loaded = loadWikiPages(fs, '/repo/.fleet/wiki');
    const report = validateWiki(fs, '/repo', '/repo/.fleet/wiki', loaded);
    expect(report.errors.map((error) => error.code)).toContain('dead_link');
  });

  it('页面未被 index 收录 → index_out_of_sync', () => {
    const fs = healthyWiki();
    fs.writeFile(
      '/repo/.fleet/wiki/domains/extra.md',
      pageRaw('domains/extra.md', 'extra', ['.'], '新页面'),
    );
    const loaded = loadWikiPages(fs, '/repo/.fleet/wiki');
    const report = validateWiki(fs, '/repo', '/repo/.fleet/wiki', loaded);
    const hit = report.errors.find(
      (error) => error.code === 'index_out_of_sync',
    );
    expect(hit?.pagePath).toBe('domains/extra.md');
  });

  it('front matter 损坏 → bad_frontmatter；未配对围栏 → unpaired_fence', () => {
    const fs = healthyWiki();
    fs.writeFile('/repo/.fleet/wiki/domains/broken.md', '无 front matter');
    fs.writeFile(
      '/repo/.fleet/wiki/domains/unpaired.md',
      pageRaw('domains/unpaired.md', 'x', ['.'], '内容').replace(FENCE_END, ''),
    );
    const loaded = loadWikiPages(fs, '/repo/.fleet/wiki');
    const report = validateWiki(fs, '/repo', '/repo/.fleet/wiki', loaded);
    const codes = report.errors.map((error) => error.code);
    expect(codes).toContain('bad_frontmatter');
    expect(codes).toContain('unpaired_fence');
  });

  it('人工自由文本中的非路径 token 不误报', () => {
    const fs = healthyWiki();
    fs.writeFile(
      '/repo/.fleet/wiki/decisions/note.md',
      pageRaw(
        'decisions/note.md',
        '手记',
        ['.'],
        undefined,
        '这是 `自由 引用` 与 `普通的词`，不校验。\n',
      ),
    );
    const loaded = loadWikiPages(fs, '/repo/.fleet/wiki');
    const report = validateWiki(fs, '/repo', '/repo/.fleet/wiki', loaded);
    expect(
      report.errors.filter((error) => error.code === 'dead_reference'),
    ).toEqual([]);
  });
});

describe('renderIndexNav / indexLinkedPaths', () => {
  it('导航按分区分组，链接路径与页面路径一致', () => {
    const fs = healthyWiki();
    const loaded = loadWikiPages(fs, '/repo/.fleet/wiki');
    const nav = renderIndexNav(loaded.pages);
    expect(nav).toContain('## domains');
    expect(nav).toContain('[core](domains/core.md)');
    expect(nav).toContain('[术语表](glossary.md)');
    const indexPage = loaded.pages.find((page) => page.path === INDEX_PATH);
    void indexPage;
  });
});
