import { cp, mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';

/**
 * wiki e2e 夹具助手（tasks.md T002）：在 tmp 目录组装可控 git 仓库。
 * M1 夹具（tests/fixtures/sample-repo）无 git 历史；增量更新与 stale
 * 判定需要可控 diff，故 e2e 一律在本助手产出的 tmp 仓库上执行，
 * 不向本仓库 .fleet/ 写任何测试产物。
 */

export interface WikiFixture {
  /** tmp 仓库根（绝对路径） */
  root: string;
  /** 追加提交：写入文件并 git commit */
  commit(files: Record<string, string>, message: string): Promise<void>;
  /** 修改文件（不提交，制造工作区漂移） */
  write(files: Record<string, string>): Promise<void>;
  /** 读取仓库内文件内容 */
  read(relative: string): Promise<string>;
  /** 当前 HEAD sha */
  head(): Promise<string>;
  destroy(): Promise<void>;
}

const MONOREPO_FILES: Record<string, string> = {
  'package.json': JSON.stringify(
    {
      name: 'fixture-fleet',
      private: true,
      version: '0.1.0',
      scripts: { build: 'pnpm -r build', test: 'vitest run' },
    },
    null,
    2,
  ),
  'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
  'README.md': '# Fixture Fleet\n\nwiki e2e 夹具仓库。\n',
  'packages/core/package.json': JSON.stringify(
    {
      name: '@fixture/core',
      version: '0.1.0',
      description: '夹具核心包',
    },
    null,
    2,
  ),
  'packages/core/src/index.ts': `/**
 * @fixture/core — 夹具核心：配置与错误模型。
 * - config  配置加载
 * - errors  统一错误
 */

export const CORE_READY = true;

export class FixtureError extends Error {
  constructor(message: string) {
    super(message);
  }
}
`,
  'packages/repository/package.json': JSON.stringify(
    {
      name: '@fixture/repository',
      version: '0.1.0',
      description: '夹具仓库智能包',
      dependencies: { '@fixture/core': 'workspace:*' },
    },
    null,
    2,
  ),
  'packages/repository/src/index.ts': `/**
 * @fixture/repository — 夹具仓库智能（依赖 @fixture/core）。
 */

export const REPOSITORY_READY = true;

export function investigateFixture(question: string): string {
  return \`investigating: \${question}\`;
}
`,
};

export async function createWikiFixture(): Promise<WikiFixture> {
  const root = await mkdtemp(path.join(tmpdir(), 'fleet-wiki-'));
  for (const [relative, content] of Object.entries(MONOREPO_FILES)) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), content, 'utf8');
  }
  await git(root, ['init']);
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-m', 'fixture: baseline']);

  return {
    root,
    async commit(files, message) {
      for (const [relative, content] of Object.entries(files)) {
        await mkdir(path.dirname(path.join(root, relative)), {
          recursive: true,
        });
        await writeFile(path.join(root, relative), content, 'utf8');
      }
      await git(root, ['add', '-A']);
      await git(root, ['commit', '-m', message]);
    },
    async write(files) {
      for (const [relative, content] of Object.entries(files)) {
        await writeFile(path.join(root, relative), content, 'utf8');
      }
    },
    async read(relative) {
      const { readFile } = await import('node:fs/promises');
      return readFile(path.join(root, relative), 'utf8');
    },
    async head() {
      const result = await git(root, ['rev-parse', 'HEAD']);
      return result.stdout.trim();
    },
    async destroy() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** 非 git 仓库夹具（同一目录结构，无任何提交） */
export async function createNonGitFixture(): Promise<WikiFixture> {
  const root = await mkdtemp(path.join(tmpdir(), 'fleet-wiki-nogit-'));
  for (const [relative, content] of Object.entries(MONOREPO_FILES)) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), content, 'utf8');
  }
  return {
    root,
    async commit() {
      throw new Error('非 git 夹具不支持 commit');
    },
    async write(files) {
      for (const [relative, content] of Object.entries(files)) {
        await writeFile(path.join(root, relative), content, 'utf8');
      }
    },
    async read(relative) {
      const { readFile } = await import('node:fs/promises');
      return readFile(path.join(root, relative), 'utf8');
    },
    async head() {
      throw new Error('非 git 夹具无 HEAD');
    },
    async destroy() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** 复制 M1 夹具为独立 git 仓库（供 investigate 隔离对照使用） */
export async function createSampleRepoGitFixture(): Promise<WikiFixture> {
  const root = await mkdtemp(path.join(tmpdir(), 'fleet-wiki-sample-'));
  const source = new URL('../fixtures/sample-repo/', import.meta.url).pathname;
  await cp(source, root, { recursive: true });
  await git(root, ['init']);
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-m', 'sample-repo baseline']);
  return {
    root,
    async commit(files, message) {
      for (const [relative, content] of Object.entries(files)) {
        await mkdir(path.dirname(path.join(root, relative)), {
          recursive: true,
        });
        await writeFile(path.join(root, relative), content, 'utf8');
      }
      await git(root, ['add', '-A']);
      await git(root, ['commit', '-m', message]);
    },
    async write(files) {
      for (const [relative, content] of Object.entries(files)) {
        await writeFile(path.join(root, relative), content, 'utf8');
      }
    },
    async read(relative) {
      const { readFile } = await import('node:fs/promises');
      return readFile(path.join(root, relative), 'utf8');
    },
    async head() {
      const result = await git(root, ['rev-parse', 'HEAD']);
      return result.stdout.trim();
    },
    async destroy() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function git(cwd: string, args: string[]): Promise<{ stdout: string }> {
  const result = await execa('git', args, {
    cwd,
    reject: false,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'fleet-test',
      GIT_AUTHOR_EMAIL: 'test@fleet.local',
      GIT_COMMITTER_NAME: 'fleet-test',
      GIT_COMMITTER_EMAIL: 'test@fleet.local',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
    },
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(' ')} 失败：${result.stderr || result.stdout}`,
    );
  }
  return { stdout: result.stdout };
}
