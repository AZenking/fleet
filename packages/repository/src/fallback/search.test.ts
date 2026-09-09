import path from 'node:path';
import { MemoryFileSystem, RealFileSystem } from '@fleet/core';
import { describe, expect, it } from 'vitest';
import { searchPatterns, walkSearch } from './search.js';

function memoryRepo(files: Record<string, string>): {
  fs: MemoryFileSystem;
  repoRoot: string;
} {
  const fs = new MemoryFileSystem();
  const repoRoot = '/repo';
  for (const [relative, content] of Object.entries(files)) {
    fs.writeFile(path.join(repoRoot, relative), content);
  }
  return { fs, repoRoot };
}

const REPO_FILES = {
  'src/a.ts': '// header\nexport function targetFunc() {\n  return 42\n}\n',
  'src/b.ts': 'export const consumer = targetFunc()\n',
  'node_modules/pkg/index.js': 'export function targetFunc() {}\n',
  'config/rates.yaml': 'default: 1.0\n',
};

describe('walkSearch（内置遍历兜底）', () => {
  it('命中模式并排除产物目录', async () => {
    const { fs, repoRoot } = memoryRepo(REPO_FILES);
    const hits = await walkSearch(
      { repoRoot, patterns: ['targetFunc'], fs },
      100,
    );
    const paths = hits.map((hit) => hit.filePath);
    expect(paths).toContain('src/a.ts');
    expect(paths).toContain('src/b.ts');
    expect(paths.some((filePath) => filePath.includes('node_modules'))).toBe(
      false,
    );
  });
});

describe('searchPatterns（引擎选择与降级）', () => {
  it('forceWalk → walk 且不算 degraded（测试确定性）', async () => {
    const { fs, repoRoot } = memoryRepo(REPO_FILES);
    const outcome = await searchPatterns({
      repoRoot,
      patterns: ['targetFunc'],
      fs,
      forceWalk: true,
    });
    expect(outcome.engine).toBe('walk');
    expect(outcome.degraded).toBe(false);
    expect(outcome.hits.length).toBeGreaterThan(0);
  });

  it('rg 不存在 → 自动降级 walk 且 degraded=true', async () => {
    const { fs, repoRoot } = memoryRepo(REPO_FILES);
    const outcome = await searchPatterns({
      repoRoot,
      patterns: ['targetFunc'],
      fs,
      rgCommand: 'definitely-not-rg',
    });
    expect(outcome.engine).toBe('walk');
    expect(outcome.degraded).toBe(true);
    expect(outcome.hits.length).toBeGreaterThan(0);
  });

  it('真实 rg 在本仓库可用 → ripgrep 引擎', async () => {
    const outcome = await searchPatterns({
      repoRoot: process.cwd(),
      patterns: ['CORE_READY'],
      fs: new RealFileSystem(),
    });
    expect(outcome.engine).toBe('ripgrep');
    expect(outcome.degraded).toBe(false);
    expect(
      outcome.hits.some((hit) => hit.filePath === 'packages/core/src/index.ts'),
    ).toBe(true);
  });
});
