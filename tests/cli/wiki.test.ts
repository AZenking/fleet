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
