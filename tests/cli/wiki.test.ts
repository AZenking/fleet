import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createNonGitFixture,
  createWikiFixture,
  type WikiFixture,
} from '../helpers/git-repo-fixture.js';

/**
 * fleet wiki 进程级 e2e。一律在 tmp 夹具仓库执行（tasks.md Notes：
 * 不向本仓库 .fleet/ 写测试产物）；本仓库真实走查在 quickstart（T023）。
 */

const bin = new URL('../../apps/cli/dist/bin.js', import.meta.url).pathname;

async function runFleet(args: string[], options: { cwd?: string } = {}) {
  return execa(process.execPath, [bin, ...args], {
    cwd: options.cwd,
    reject: false,
  });
}

let fixture: WikiFixture;
let nonGit: WikiFixture;

beforeAll(async () => {
  fixture = await createWikiFixture();
  nonGit = await createNonGitFixture();
});

afterAll(async () => {
  await fixture.destroy();
  await nonGit.destroy();
});

describe('fleet wiki init / build（US1 / SC-001）', () => {
  it('init 建立骨架且幂等', async () => {
    const first = await runFleet([
      'wiki',
      'init',
      '--repo',
      fixture.root,
      '--json',
    ]);
    expect(first.exitCode).toBe(0);
    const created = JSON.parse(first.stdout).created as string[];
    expect(created).toContain('index.md');
    expect(created).toContain('glossary.md');

    const second = await runFleet([
      'wiki',
      'init',
      '--repo',
      fixture.root,
      '--json',
    ]);
    expect(second.exitCode).toBe(0);
    expect(JSON.parse(second.stdout).created).toEqual([]);
  });

  it('build 产出完整结构、front matter 锚定、index 收录全（FR-002/003）', async () => {
    const result = await runFleet([
      'wiki',
      'build',
      '--repo',
      fixture.root,
      '--json',
    ]);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.validation.ok).toBe(true);
    for (const page of [
      'architecture/overview.md',
      'domains/core.md',
      'domains/repository.md',
      'infrastructure/tooling.md',
      'index.md',
    ]) {
      expect(report.pagesWritten).toContain(page);
    }
    // stderr 事件
    expect(result.stderr).toContain('wiki.build.completed');
    // SC-001：init+build ≤ 30s（此处断言 build 段）
    expect(report.durationMs).toBeLessThanOrEqual(30_000);
  });

  it('生成页面：front matter 三要素 + 路径锚定真实文件（FR-004）', async () => {
    const page = await fixture.read('.fleet/wiki/domains/repository.md');
    expect(page).toContain('generated_from:');
    expect(page).toContain('updated_at:');
    expect(page).toContain('scope:');
    expect(page).toContain('`packages/repository`');
    expect(page).toContain('夹具仓库智能');
    // 反引号路径 100% 锚定（SC 抽查自动化）
    for (const match of page.matchAll(/`([^`\n]+)`/g)) {
      const token = match[1];
      if (
        token !== undefined &&
        /^[A-Za-z0-9._\-/]+$/.test(token) &&
        token.includes('/')
      ) {
        const probe = await execa('test', ['-e', `${fixture.root}/${token}`], {
          reject: false,
        });
        expect(probe.exitCode).toBe(0);
      }
    }
  });

  it('幂等重跑：全部页面 unchanged（FR-002 幂等语义）', async () => {
    const result = await runFleet([
      'wiki',
      'build',
      '--repo',
      fixture.root,
      '--json',
    ]);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.pagesWritten).toEqual([]);
    expect(report.pagesUnchanged).toContain('domains/core.md');
    expect(report.pagesUnchanged).toContain('index.md');
  });

  it('非 git 仓库：build 标注 missing 锚点，退出码 0（US1 场景 4）', async () => {
    const result = await runFleet([
      'wiki',
      'build',
      '--repo',
      nonGit.root,
      '--json',
    ]);
    expect(result.exitCode).toBe(0);
    const page = await nonGit.read('.fleet/wiki/domains/core.md');
    expect(page).not.toContain('generated_from:');
    // validator 不因缺锚点报错（缺失是显式状态，不是错误）
    expect(JSON.parse(result.stdout).validation.ok).toBe(true);
  });

  it('index 导航覆盖全部页面（FR-003，两跳可达）', async () => {
    const index = await fixture.read('.fleet/wiki/index.md');
    expect(index).toContain('## architecture');
    expect(index).toContain('[仓库总览](architecture/overview.md)');
    expect(index).toContain('[@fixture/core](domains/core.md)');
    expect(index).toContain('[术语表](glossary.md)');
  });
});

describe('fleet wiki query（US2 / SC-006 + 状态语义矩阵）', () => {
  it('命中：相关页面 + scoreBreakdown，≤2s（SC-006）', async () => {
    const result = await runFleet([
      'wiki',
      'query',
      'investigateFixture 夹具仓库智能',
      '--repo',
      fixture.root,
      '--json',
    ]);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.engine).toBe('ripgrep');
    expect(report.durationMs).toBeLessThanOrEqual(2_000);
    const topPaths = report.hits.map(
      (hit: { pagePath: string }) => hit.pagePath,
    );
    expect(topPaths).toContain('domains/repository.md');
    expect(topPaths).not.toContain('index.md');
    expect(report.hits[0].scoreBreakdown).toBeDefined();
    expect(result.stderr).toContain('wiki.query.completed');
  });

  it('无命中：空结果 + 主题建议，退出码 0（FR-006）', async () => {
    const result = await runFleet([
      'wiki',
      'query',
      'zzz不存在的主题xyz',
      '--repo',
      fixture.root,
      '--json',
    ]);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.hits).toEqual([]);
    expect(report.suggestions.length).toBeGreaterThan(0);
  });

  it('文本模式：问题与命中行', async () => {
    const result = await runFleet([
      'wiki',
      'query',
      '夹具核心包',
      '--repo',
      fixture.root,
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('问题：');
    expect(result.stdout).toContain('domains/core.md');
  });

  it('wiki 缺失：退出码 1 + 修复指引（D9 矩阵）', async () => {
    const empty = await createWikiFixture();
    try {
      const result = await runFleet([
        'wiki',
        'query',
        '任意问题',
        '--repo',
        empty.root,
        '--json',
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('fleet wiki init');
    } finally {
      await empty.destroy();
    }
  });

  it('stale：警告后照常检索，退出码 0（US2 场景 3）', async () => {
    await fixture.commit(
      { 'packages/core/src/extra.ts': 'export const EXTRA = 1;\n' },
      'fixture: touch core',
    );
    const result = await runFleet([
      'wiki',
      'query',
      '夹具仓库智能',
      '--repo',
      fixture.root,
      '--json',
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('wiki 已过期');
    expect(JSON.parse(result.stdout).hits.length).toBeGreaterThan(0);
  });
});

describe('fleet wiki status / update（US3 / SC-003 / SC-004）', () => {
  // 前置：query 段最后一次测试已提交 packages/core/src/extra.ts，
  // wiki 锚点因此落后（stale 基线）

  it('status：页面级判定 100% 准确（SC-004）', async () => {
    const result = await runFleet([
      'wiki',
      'status',
      '--repo',
      fixture.root,
      '--json',
    ]);
    expect(result.exitCode).toBe(0);
    const status = JSON.parse(result.stdout);
    expect(status.state).toBe('stale');
    expect(status.changedFiles).toContain('packages/core/src/extra.ts');
    const byPath = new Map(
      status.pages.map((page: { path: string; stale: boolean }) => [
        page.path,
        page.stale,
      ]),
    );
    expect(byPath.get('domains/core.md')).toBe(true);
    expect(byPath.get('architecture/overview.md')).toBe(true);
    expect(byPath.get('domains/repository.md')).toBe(false);
    // 静态骨架页不受仓库提交影响（scope .fleet/wiki）
    expect(byPath.get('glossary.md')).toBe(false);
    expect(result.stderr).toContain('wiki.status.completed');
  });

  it('status：fresh 态退出码仍为 0（fresh/stale/unknown 均有效）', async () => {
    await runFleet(['wiki', 'update', '--repo', fixture.root, '--json']);
    const result = await runFleet([
      'wiki',
      'status',
      '--repo',
      fixture.root,
      '--json',
    ]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).state).toBe('fresh');
  });

  it('update：受影响页刷新、无关页逐字节不变（SC-003）', async () => {
    // 构造新的受影响变更：触碰 repository 包
    await fixture.commit(
      {
        'packages/repository/src/investigate.ts':
          'export function investigateFixture2() {}\n',
      },
      'fixture: touch repository',
    );
    const repositoryBefore = await fixture.read(
      '.fleet/wiki/domains/repository.md',
    );
    const coreBefore = await fixture.read('.fleet/wiki/domains/core.md');
    const glossaryBefore = await fixture.read('.fleet/wiki/glossary.md');

    const result = await runFleet([
      'wiki',
      'update',
      '--repo',
      fixture.root,
      '--json',
    ]);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.pagesWritten).toContain('domains/repository.md');
    expect(report.pagesWritten).toContain('architecture/overview.md');
    expect(report.pagesWritten).toContain('index.md');
    expect(report.pagesWritten).not.toContain('domains/core.md');

    // 逐字节断言：无关页面零变化（SC-003）
    expect(await fixture.read('.fleet/wiki/domains/core.md')).toBe(coreBefore);
    expect(await fixture.read('.fleet/wiki/glossary.md')).toBe(glossaryBefore);
    // 受影响页面被刷新（锚点推进，内容可能相同但元数据更新）
    expect(await fixture.read('.fleet/wiki/domains/repository.md')).not.toBe(
      repositoryBefore,
    );
    expect(result.stderr).toContain('wiki.update.completed');
  });

  it('mixed 页人工区保留 + .backup 出现（FR-009，SC-003 人工保护）', async () => {
    const pagePath = '.fleet/wiki/domains/core.md';
    const original = await fixture.read(pagePath);
    // 围栏外（文件末尾）追加人工内容 → mixed 页
    await fixture.write({
      [pagePath]: `${original}\n人工补充：core 的注意事项。\n`,
    });

    await fixture.commit(
      { 'packages/core/src/another.ts': 'export const ANOTHER = 1;\n' },
      'fixture: touch core again',
    );

    const result = await runFleet([
      'wiki',
      'update',
      '--repo',
      fixture.root,
      '--json',
    ]);
    expect(result.exitCode).toBe(0);
    const updated = await fixture.read(pagePath);
    expect(updated).toContain('人工补充：core 的注意事项。');
    const report = JSON.parse(result.stdout);
    expect(
      report.backups.some((backup: string) => backup.includes('core.md')),
    ).toBe(true);
    const backup = await fixture.read('.fleet/wiki/.backup/domains/core.md');
    expect(backup).toContain('人工补充：core 的注意事项。');
  });

  it('非 git 仓库：update 无操作 + note 提示', async () => {
    await runFleet(['wiki', 'build', '--repo', nonGit.root, '--json']);
    const result = await runFleet([
      'wiki',
      'update',
      '--repo',
      nonGit.root,
      '--json',
    ]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).note).toContain('fleet wiki build');
  });

  it('wiki 缺失：update 退出码 1 + 指引', async () => {
    const empty = await createWikiFixture();
    try {
      const result = await runFleet([
        'wiki',
        'update',
        '--repo',
        empty.root,
        '--json',
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('fleet wiki init');
    } finally {
      await empty.destroy();
    }
  });
});
