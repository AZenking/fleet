import { describe, expect, it } from 'vitest';

import { MemoryFileSystem } from '@fleet/core';

import { loadWikiPages, pathExists } from '../format.js';
import { initWiki, scanRepo } from './skeleton.js';

/**
 * generator 单元测试（tasks.md T013）：MemoryFileSystem 注入，不触磁盘。
 * monorepo / 非 monorepo 两形态的事实提取断言（research.md D5）。
 */

function monorepoFs(): MemoryFileSystem {
  const fs = new MemoryFileSystem();
  fs.writeFile(
    '/repo/package.json',
    JSON.stringify({
      name: 'fixture-fleet',
      private: true,
      scripts: { build: 'pnpm -r build', test: 'vitest run' },
    }),
  );
  fs.writeFile('/repo/pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
  fs.writeFile(
    '/repo/packages/core/package.json',
    JSON.stringify({
      name: '@fixture/core',
      description: '夹具核心包',
    }),
  );
  fs.writeFile(
    '/repo/packages/core/src/index.ts',
    `/**\n * @fixture/core — 夹具核心。\n * - config  配置\n */\nexport const READY = true;\n`,
  );
  fs.writeFile(
    '/repo/packages/repository/package.json',
    JSON.stringify({
      name: '@fixture/repository',
      description: '夹具仓库包',
      dependencies: { '@fixture/core': 'workspace:*', execa: '^10' },
    }),
  );
  fs.writeFile(
    '/repo/packages/repository/src/index.ts',
    `/**\n * @fixture/repository — 夹具仓库智能。\n */\nexport const OK = true;\n`,
  );
  fs.writeFile(
    '/repo/packages/repository/src/investigate.ts',
    'export function investigate() {\n  return 1;\n}\n',
  );
  return fs;
}

describe('scanRepo（monorepo 形态）', () => {
  it('每包一页：依赖拆分、模块注释、目录结构、scope 正确', () => {
    const scan = scanRepo(monorepoFs(), '/repo');
    expect(scan.isMonorepo).toBe(true);
    const repoPage = scan.specs.find(
      (spec) => spec.path === 'domains/repository.md',
    );
    expect(repoPage).toBeDefined();
    expect(repoPage?.scope).toEqual(['packages/repository']);
    expect(repoPage?.content).toContain('位置：`packages/repository`');
    expect(repoPage?.content).toContain('内部依赖：`@fixture/core`');
    expect(repoPage?.content).toContain('外部依赖：`execa`');
    expect(repoPage?.content).toContain('夹具仓库智能');
    expect(repoPage?.content).toContain('investigate.ts');

    const corePage = scan.specs.find((spec) => spec.path === 'domains/core.md');
    expect(corePage?.scope).toEqual(['packages/core']);
    expect(corePage?.content).toContain('内部依赖：（无）');
  });

  it('overview 含内部依赖邻接表，scope 为全仓库', () => {
    const scan = scanRepo(monorepoFs(), '/repo');
    const overview = scan.specs.find(
      (spec) => spec.path === 'architecture/overview.md',
    );
    expect(overview?.scope).toEqual(['.']);
    expect(overview?.content).toContain('`packages/repository`');
    expect(overview?.content).toContain('`@fixture/core`');
  });

  it('tooling 收录根脚本与配置探测，scope 覆盖根配置文件', () => {
    const scan = scanRepo(monorepoFs(), '/repo');
    const tooling = scan.specs.find(
      (spec) => spec.path === 'infrastructure/tooling.md',
    );
    expect(tooling).toBeDefined();
    expect(tooling?.content).toContain('`build` — pnpm -r build');
    expect(tooling?.content).toContain(
      'pnpm workspace 定义：`pnpm-workspace.yaml`',
    );
    expect(tooling?.scope).toContain('package.json');
    expect(tooling?.scope).toContain('pnpm-workspace.yaml');
  });

  it('全部生成内容的路径引用锚定真实文件/目录（FR-004 前提）', () => {
    const fs = monorepoFs();
    const scan = scanRepo(fs, '/repo');
    for (const spec of scan.specs) {
      for (const match of spec.content.matchAll(/`([^`\n]+)`/g)) {
        const token = match[1];
        if (
          token !== undefined &&
          token.includes('/') &&
          /^[A-Za-z0-9._\-/]+$/.test(token)
        ) {
          expect(pathExists(fs, `/repo/${token}`)).toBe(true);
        }
      }
    }
  });
});

describe('scanRepo（非 monorepo 兜底）', () => {
  it('src/ 结构扫描产出真实条目', () => {
    const fs = new MemoryFileSystem();
    fs.writeFile('/repo/package.json', '{"name":"plain"}');
    fs.writeFile('/repo/src/main.ts', 'export const X = 1;\n');
    fs.writeFile('/repo/src/auth/login.ts', 'export function login() {}\n');
    fs.writeFile('/repo/src/auth/session.ts', 'export function session() {}\n');
    const scan = scanRepo(fs, '/repo');
    expect(scan.isMonorepo).toBe(false);
    const overview = scan.specs.find(
      (spec) => spec.path === 'architecture/overview.md',
    );
    expect(overview?.content).toContain('单项目');
    const authPage = scan.specs.find((spec) => spec.path === 'domains/auth.md');
    expect(authPage?.scope).toEqual(['src/auth']);
    expect(authPage?.content).toContain('`src/auth/login.ts`');
  });
});

describe('initWiki（FR-001 幂等）', () => {
  it('建立 index + 四分区 + glossary；重复 init 不覆盖人工内容', () => {
    const fs = monorepoFs();
    const first = initWiki(
      fs,
      '/repo',
      '/repo/.fleet/wiki',
      () => '2026-09-10T00:00:00.000Z',
    );
    expect(first.created).toContain('index.md');
    expect(first.created).toContain('glossary.md');
    expect(first.created).toContain('decisions/README.md');
    for (const dir of [
      'architecture',
      'domains',
      'infrastructure',
      'decisions',
    ]) {
      expect(first.created).toContain(`${dir}/README.md`);
    }

    // 人工改写 glossary 围栏外内容后重复 init：原样保留
    const glossaryPath = '/repo/.fleet/wiki/glossary.md';
    const original = fs.readFile(glossaryPath);
    fs.writeFile(glossaryPath, `${original}人工补充。\n`);
    const second = initWiki(
      fs,
      '/repo',
      '/repo/.fleet/wiki',
      () => '2026-09-11T00:00:00.000Z',
    );
    expect(second.created).toEqual([]);
    expect(fs.readFile(glossaryPath)).toContain('人工补充。');
  });

  it('骨架页面全部可被格式层解析（generated/manual origin 正确）', () => {
    const fs = monorepoFs();
    initWiki(
      fs,
      '/repo',
      '/repo/.fleet/wiki',
      () => '2026-09-10T00:00:00.000Z',
    );
    const loaded = loadWikiPages(fs, '/repo/.fleet/wiki');
    expect(loaded.errors).toEqual([]);
    expect(loaded.pages.length).toBeGreaterThanOrEqual(7);
    const index = loaded.pages.find((page) => page.path === 'index.md');
    expect(index?.origin).toBe('generated');
    const readme = loaded.pages.find(
      (page) => page.path === 'architecture/README.md',
    );
    expect(readme?.origin).toBe('manual');
  });
});

describe('M2 缺陷回归：domains 引用基准 = 仓库根（防 dead_reference 误报）', () => {
  it('顶层 src/ 布局：生成的路径 token 全部相对仓库根存在', () => {
    const fs = new MemoryFileSystem();
    fs.writeFile('/repo/package.json', '{ "name": "app" }');
    fs.writeFile('/repo/src/util/version.js', 'export const V = 1;\n');
    fs.writeFile('/repo/src/util/platform.js', 'export const P = 2;\n');
    fs.writeFile('/repo/src/views/index.vue', '<template/>\n');
    const scan = scanRepo(fs, '/repo');
    const domainPages = scan.specs.filter((spec) =>
      spec.path.startsWith('domains/'),
    );
    expect(domainPages.length).toBeGreaterThanOrEqual(2); // util + views
    const utilPage = domainPages.find(
      (spec) => spec.path === 'domains/util.md',
    );
    expect(utilPage?.content).toContain('- `src/util/version.js`');
    // 校验器语义：token 按仓库根解析必须存在
    for (const spec of domainPages) {
      const tokens = [...spec.content.matchAll(/`([^`\\n]+)`/g)]
        .map((m) => m[1]!)
        .filter((t) => t.includes('/') && /^[@A-Za-z0-9._\-/]+$/.test(t));
      for (const token of tokens) {
        expect(
          pathExists(fs, `/repo/${token}`),
          `token ${token} 应按仓库根可解析`,
        ).toBe(true);
      }
    }
  });
});
