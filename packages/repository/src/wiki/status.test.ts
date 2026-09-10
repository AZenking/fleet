import { describe, expect, it } from 'vitest';

import { MemoryFileSystem } from '@fleet/core';

import { buildWiki } from './generator/build.js';
import { FakeWikiGit } from './git.js';
import { computeWikiStatus } from './status.js';
import { updateWiki } from './updater.js';

/**
 * status/updater 单元测试（tasks.md T020 前半）：
 * SC-004 纯集合运算矩阵 + SC-003 增量分派（FR-008/009）。
 * 全部 MemoryFileSystem + FakeWikiGit 注入，不触磁盘与真实 git。
 */

const SHA1 = '1111111111111111111111111111111111111111';
const SHA2 = '2222222222222222222222222222222222222222';
const NOW = () => '2026-09-10T00:00:00.000Z';

function monorepoFs(): MemoryFileSystem {
  const fs = new MemoryFileSystem();
  fs.writeFile('/repo/package.json', '{"name":"fixture-fleet","private":true}');
  fs.writeFile('/repo/pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
  fs.writeFile('/repo/packages/core/package.json', '{"name":"@fixture/core"}');
  fs.writeFile(
    '/repo/packages/core/src/index.ts',
    '/**\n * core 模块。\n */\nexport const X = 1;\n',
  );
  fs.writeFile(
    '/repo/packages/repository/package.json',
    '{"name":"@fixture/repository","dependencies":{"@fixture/core":"workspace:*"}}',
  );
  fs.writeFile(
    '/repo/packages/repository/src/index.ts',
    '/**\n * repository 模块。\n */\nexport const Y = 2;\n',
  );
  return fs;
}

async function builtWiki(fs: MemoryFileSystem) {
  return buildWiki({
    repoRoot: '/repo',
    fs,
    git: new FakeWikiGit({ headSha: SHA1 }),
    now: NOW,
  });
}

describe('computeWikiStatus（SC-004）', () => {
  it('fresh：HEAD 与锚点一致（changedFiles 为空）', async () => {
    const fs = monorepoFs();
    await builtWiki(fs);
    const status = await computeWikiStatus({
      repoRoot: '/repo',
      fs,
      git: new FakeWikiGit({ headSha: SHA1, changedFiles: [], aheadCount: 0 }),
    });
    expect(status.exists).toBe(true);
    expect(status.state).toBe('fresh');
    expect(status.pages.every((page) => !page.stale)).toBe(true);
  });

  it('stale：命中页面级 scope——packages/core 只影响 core 页与 overview/index', async () => {
    const fs = monorepoFs();
    await builtWiki(fs);
    const status = await computeWikiStatus({
      repoRoot: '/repo',
      fs,
      git: new FakeWikiGit({
        headSha: SHA2,
        changedFiles: ['packages/core/src/index.ts'],
        aheadCount: 1,
      }),
    });
    expect(status.state).toBe('stale');
    const byPath = new Map(status.pages.map((page) => [page.path, page]));
    expect(byPath.get('domains/core.md')?.stale).toBe(true);
    expect(byPath.get('domains/core.md')?.matchedScope).toEqual([
      'packages/core',
    ]);
    expect(byPath.get('domains/repository.md')?.stale).toBe(false);
    expect(byPath.get('architecture/overview.md')?.stale).toBe(true);
    expect(status.aheadCommits).toBe(1);
    // 静态骨架页（scope .fleet/wiki）不受仓库提交影响
    expect(byPath.get('glossary.md')?.stale).toBe(false);
    expect(byPath.get('decisions/DECISION-TEMPLATE.md')?.stale).toBe(false);
  });

  it('unknown：非 git / 无锚点，不猜测', async () => {
    const fs = monorepoFs();
    await builtWiki(fs);
    const status = await computeWikiStatus({
      repoRoot: '/repo',
      fs,
      git: new FakeWikiGit({ headSha: new Error('非 git 仓库') }),
    });
    expect(status.state).toBe('unknown');
    expect(status.pages.every((page) => !page.stale)).toBe(true);
  });

  it('wiki 缺失：exists=false', async () => {
    const status = await computeWikiStatus({
      repoRoot: '/repo',
      fs: new MemoryFileSystem(),
      git: new FakeWikiGit({ headSha: SHA1 }),
    });
    expect(status.exists).toBe(false);
  });
});

describe('updateWiki（SC-003 / FR-008 / FR-009）', () => {
  it('增量：受影响页 100% 刷新，无关页零触碰（逐字节）', async () => {
    const fs = monorepoFs();
    await builtWiki(fs);
    const repositoryBefore = fs.readFile(
      '/repo/.fleet/wiki/domains/repository.md',
    );
    const coreBefore = fs.readFile('/repo/.fleet/wiki/domains/core.md');

    const result = await updateWith(fs, SHA2, ['packages/core/src/index.ts']);

    expect(result.pagesWritten).toContain('domains/core.md');
    expect(result.pagesWritten).toContain('architecture/overview.md');
    expect(result.pagesWritten).toContain('index.md');
    expect(fs.readFile('/repo/.fleet/wiki/domains/repository.md')).toBe(
      repositoryBefore,
    );
    expect(fs.readFile('/repo/.fleet/wiki/domains/core.md')).not.toBe(
      coreBefore,
    );
    // 锚点推进到新 HEAD
    expect(fs.readFile('/repo/.fleet/wiki/domains/core.md')).toContain(SHA2);
    // 再次 status：fresh
    const status = await computeWikiStatus({
      repoRoot: '/repo',
      fs,
      git: new FakeWikiGit({ headSha: SHA2, changedFiles: [] }),
    });
    expect(status.state).toBe('fresh');
  });

  it('mixed 页：人工区逐字节保留 + 备份出现（FR-009）', async () => {
    const fs = monorepoFs();
    await builtWiki(fs);
    const corePath = '/repo/.fleet/wiki/domains/core.md';
    const original = fs.readFile(corePath);
    fs.writeFile(corePath, `${original}人工补充的核心说明。\n`);

    const result = await updateWith(fs, SHA2, ['packages/core/src/index.ts']);

    const updated = fs.readFile(corePath);
    expect(updated).toContain('人工补充的核心说明。');
    expect(result.backups.some((backup) => backup.includes('core.md'))).toBe(
      true,
    );
    expect(
      fs.readFileOptional('/repo/.fleet/wiki/.backup/domains/core.md'),
    ).toContain('人工补充的核心说明。');
  });

  it('manual 页：stale 也只跳过并提示，不重写', async () => {
    const fs = monorepoFs();
    await builtWiki(fs);
    const readmePath = '/repo/.fleet/wiki/architecture/README.md';
    fs.writeFile(
      readmePath,
      [
        '---',
        'title: 手写总览',
        'updated_at: 2026-09-10T00:00:00.000Z',
        'scope:',
        '  - .',
        '---',
        '',
        '完全人工的页面。\n',
      ].join('\n'),
    );
    const before = fs.readFile(readmePath);

    const result = await updateWith(fs, SHA2, ['packages/core/src/index.ts']);

    expect(fs.readFile(readmePath)).toBe(before);
    expect(result.pagesSkipped).toContain('architecture/README.md');
  });

  it('unknown 锚点：无操作 + note 提示（不假装增量可行）', async () => {
    const fs = monorepoFs();
    await builtWiki(fs);
    const result = await updateWiki({
      repoRoot: '/repo',
      fs,
      git: new FakeWikiGit({ headSha: new Error('非 git') }),
      now: NOW,
    });
    expect(result.pagesWritten).toEqual([]);
    expect(result.note).toContain('fleet wiki build');
  });
});

function updateWith(fs: MemoryFileSystem, head: string, changed: string[]) {
  return updateWiki({
    repoRoot: '/repo',
    fs,
    git: new FakeWikiGit({
      headSha: head,
      changedFiles: changed,
      aheadCount: 1,
    }),
    now: NOW,
  });
}
