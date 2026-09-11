import path from 'node:path';
import { MemoryFileSystem } from '@fleet/core';
import { describe, expect, it } from 'vitest';
import { FakeCodeGraphAdapter } from '../codegraph/fake-adapter.js';
import type { SymbolHit } from '../codegraph/contract.js';
import { investigate } from './investigate.js';
import type { FallbackReasonCode } from './types.js';

/**
 * 故障注入矩阵（SC-002 主证据）：假后端 + 内存文件系统，
 * 八类场景全部验证"降级且仍返回结果"。
 */

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

const FILES = {
  'src/a.ts': '// header\nexport function targetFunc() {\n  return 42\n}\n',
  'src/b.ts': 'export const consumer = targetFunc()\n',
};

function hit(overrides: Partial<SymbolHit> = {}): SymbolHit {
  return {
    name: 'targetFunc',
    kind: 'function',
    filePath: 'src/a.ts',
    startLine: 2,
    endLine: 4,
    ...overrides,
  };
}

function makeOptions(
  script: Parameters<typeof FakeCodeGraphAdapter>[0],
  files = FILES,
  mode?: 'auto' | 'fast' | 'verify',
) {
  const { fs, repoRoot } = memoryRepo(files);
  return {
    repoRoot,
    fs,
    adapter: new FakeCodeGraphAdapter(script),
    forceWalkSearch: true,
    ...(mode !== undefined ? { mode } : {}),
  };
}

function codes(
  fallbacks: Array<{ code: FallbackReasonCode }>,
): FallbackReasonCode[] {
  return fallbacks.map((reason) => reason.code);
}

describe('investigate 健康路径', () => {
  it('codegraph 命中 + 源码锚定；wiki 缺失仅提示不计降级（M3）', async () => {
    const result = await investigate(
      'targetFunc',
      makeOptions(
        { symbol: { ok: true, value: [hit()] } },
        undefined,
        'verify',
      ),
    );
    expect(result.fallbacks.map((reason) => reason.code)).toEqual([
      'wiki_missing',
    ]);
    expect(result.degraded).toBe(false);
    expect(result.pathsUsed).toContain('codegraph');
    expect(result.pathsUsed).toContain('source');
    expect(result.references.length).toBeGreaterThanOrEqual(1);
    const main = result.references.find(
      (reference) => reference.symbol === 'targetFunc',
    );
    expect(main?.filePath).toBe('src/a.ts');
    expect(main?.startLine).toBe(2);
    expect(main?.verified).toBe(true);
    expect(main?.snippet).toContain('export function targetFunc');
  });
});

describe('investigate 故障注入矩阵（宪法原则 I：只降级不失败）', () => {
  it('unavailable：健康检查失败 → 搜索路径仍返回', async () => {
    const result = await investigate(
      'targetFunc',
      makeOptions({
        health: {
          available: false,
          initialized: false,
          indexFresh: false,
          pendingChanges: 0,
          capabilities: [],
        },
      }),
    );
    expect(codes(result.fallbacks)).toContain('unavailable');
    expect(result.pathsUsed).not.toContain('codegraph');
    expect(result.pathsUsed).toContain('search');
    expect(
      result.references.some((reference) => reference.filePath === 'src/a.ts'),
    ).toBe(true);
    expect(result.references.every((reference) => reference.verified)).toBe(
      true,
    );
  });

  it('timeout：符号查询超时 → 降级仍出结果', async () => {
    const result = await investigate(
      'targetFunc',
      makeOptions({
        symbol: { ok: false, failure: { code: 'timeout', detail: '模拟超时' } },
      }),
    );
    expect(codes(result.fallbacks)).toContain('timeout');
    expect(
      result.references.some((reference) => reference.filePath === 'src/a.ts'),
    ).toBe(true);
  });

  it('error：符号查询报错 → 降级仍出结果', async () => {
    const result = await investigate(
      'targetFunc',
      makeOptions({
        symbol: { ok: false, failure: { code: 'error', detail: '模拟崩溃' } },
      }),
    );
    expect(codes(result.fallbacks)).toContain('error');
    expect(
      result.references.some((reference) => reference.filePath === 'src/a.ts'),
    ).toBe(true);
  });

  it('stale：索引过期 → 降级并给出 sync 建议', async () => {
    const result = await investigate(
      'targetFunc',
      makeOptions({
        health: {
          available: true,
          initialized: true,
          indexFresh: false,
          pendingChanges: 3,
          capabilities: ['search'],
        },
      }),
    );
    const stale = result.fallbacks.find((reason) => reason.code === 'stale');
    expect(stale?.detail).toContain('3 个文件比索引新');
    expect(stale?.fixSuggestion).toContain('codegraph sync');
    expect(result.references.length).toBeGreaterThan(0);
  });

  it('missing_symbol：查询为空 → 记录原因，搜索兜底', async () => {
    const result = await investigate(
      'targetFunc',
      makeOptions({ symbol: { ok: true, value: [] } }),
    );
    expect(codes(result.fallbacks)).toContain('missing_symbol');
    expect(
      result.references.some((reference) => reference.filePath === 'src/a.ts'),
    ).toBe(true);
  });

  it('ambiguous：同名符号 → 记录歧义并列出全部候选', async () => {
    const result = await investigate(
      'targetFunc',
      makeOptions(
        {
          symbol: {
            ok: true,
            value: [
              hit(),
              hit({ filePath: 'src/c.ts', startLine: 1, endLine: 3 }),
            ],
          },
        },
        { ...FILES, 'src/c.ts': 'export function targetFunc() {}\n' },
      ),
    );
    expect(codes(result.fallbacks)).toContain('ambiguous');
    const filePaths = result.references.map((reference) => reference.filePath);
    expect(filePaths).toContain('src/a.ts');
    expect(filePaths).toContain('src/c.ts');
  });

  it('empty：任何路径都无结果 → 明确"未找到"，不算失败', async () => {
    const result = await investigate(
      'NothingMatchesThis',
      makeOptions(
        { symbol: { ok: true, value: [] } },
        { 'src/a.ts': '// unrelated\n' },
      ),
    );
    expect(result.references).toEqual([]);
    expect(result.summary).toContain('未找到');
    expect(codes(result.fallbacks)).toContain('missing_symbol');
    expect(codes(result.fallbacks)).toContain('empty');
  });

  it('conflict（可修正）：行号漂移 → 按源码修正并记录（verify）', async () => {
    const result = await investigate(
      'targetFunc',
      makeOptions(
        { symbol: { ok: true, value: [hit({ startLine: 6, endLine: 8 })] } },
        undefined,
        'verify',
      ),
    );
    expect(codes(result.fallbacks)).toContain('conflict');
    const main = result.references.find(
      (reference) => reference.symbol === 'targetFunc',
    );
    expect(main?.startLine).toBe(2);
    expect(main?.verified).toBe(true);
  });

  it('conflict（不可修正）：锚点彻底失效 → 丢弃该引用，搜索兜底（verify）', async () => {
    const result = await investigate(
      'targetFunc',
      makeOptions(
        {
          symbol: { ok: true, value: [hit({ startLine: 500, endLine: 502 })] },
        },
        undefined,
        'verify',
      ),
    );
    expect(codes(result.fallbacks)).toContain('conflict');
    // 引用被丢弃后走搜索兜底，结果仍非空
    expect(
      result.references.some((reference) => reference.filePath === 'src/a.ts'),
    ).toBe(true);
  });
});

describe('investigate 高风险升级（FR-007）', () => {
  it('命中"配置驱动"关键词 → 即使 codegraph 命中也记 high_risk', async () => {
    const result = await investigate(
      'targetFunc 配置驱动',
      makeOptions({ symbol: { ok: true, value: [hit()] } }),
    );
    expect(codes(result.fallbacks)).toContain('high_risk');
    expect(
      result.references.some((reference) => reference.symbol === 'targetFunc'),
    ).toBe(true);
  });

  it('引用落在配置文件 → high_risk', async () => {
    const result = await investigate(
      'targetFunc',
      makeOptions(
        {
          symbol: {
            ok: true,
            value: [hit({ filePath: 'config/rates.yaml', kind: 'constant' })],
          },
        },
        { ...FILES, 'config/rates.yaml': 'targetFunc: here\n' },
      ),
    );
    expect(codes(result.fallbacks)).toContain('high_risk');
  });
});

describe('M11 加速器事件发射点（FR-003：只补发射，不改行为）', () => {
  it('codegraph 不可用 → codegraph.fallback 事件（行为不变）', async () => {
    const events: string[] = [];
    const { fs, repoRoot } = memoryRepo(FILES);
    const result = await investigate('targetFunc', {
      repoRoot,
      fs,
      forceWalkSearch: true,
      adapter: new FakeCodeGraphAdapter({
        health: {
          available: false,
          initialized: false,
          indexFresh: false,
          pendingChanges: 0,
          capabilities: [],
        },
      }),
      emitEvent: (event) => events.push(event.type),
    });
    expect(result.pathsUsed).toContain('search'); // 行为不变
    expect(events).toContain('codegraph.fallback');
  });

  it('缺省 emitEvent → 零事件亦零异常（向后兼容）', async () => {
    const result = await investigate('targetFunc', makeOptions({}));
    expect(result).toBeDefined();
  });
});
