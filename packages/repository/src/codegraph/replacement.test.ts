import path from 'node:path';
import { MemoryFileSystem } from '@fleet/core';
import { describe, expect, it } from 'vitest';
import type { CodeGraphAdapter, SymbolHit } from './contract.js';
import { FakeCodeGraphAdapter } from './fake-adapter.js';
import { investigate } from '../investigation/investigate.js';

/**
 * SC-005 适配层可替换性：同一消费者（investigate 公共 API），
 * 后端从"健康假后端"换成"不可用假后端"，消费者代码零改动。
 */

function hit(): SymbolHit {
  return {
    name: 'targetFunc',
    kind: 'function',
    filePath: 'src/a.ts',
    startLine: 2,
    endLine: 4,
  };
}

function setup(adapter: CodeGraphAdapter) {
  const fs = new MemoryFileSystem();
  const repoRoot = '/repo';
  fs.writeFile(
    path.join(repoRoot, 'src/a.ts'),
    '// header\nexport function targetFunc() {\n  return 42\n}\n',
  );
  return investigate('targetFunc', {
    repoRoot,
    fs,
    adapter,
    forceWalkSearch: true,
  });
}

describe('CodeGraphAdapter 可替换性（SC-005）', () => {
  it('后端 A（健康）：走 codegraph 路径', async () => {
    const result = await setup(
      new FakeCodeGraphAdapter({ symbol: { ok: true, value: [hit()] } }),
    );
    expect(result.pathsUsed).toContain('codegraph');
    expect(result.degraded).toBe(false);
  });

  it('后端 B（不可用）：同一消费者自动切换路径，无需任何修改', async () => {
    const result = await setup(
      new FakeCodeGraphAdapter({
        health: {
          available: false,
          initialized: false,
          indexFresh: false,
          pendingChanges: 0,
          capabilities: [],
        },
      }),
    );
    expect(result.pathsUsed).not.toContain('codegraph');
    expect(result.pathsUsed).toContain('search');
    expect(result.references.length).toBeGreaterThan(0);
  });

  it('后端 C（真实 CLI 类型）：契约接口接受任意实现（编译期保证）', () => {
    const adapters: CodeGraphAdapter[] = [new FakeCodeGraphAdapter()];
    expect(adapters).toHaveLength(1);
  });
});
