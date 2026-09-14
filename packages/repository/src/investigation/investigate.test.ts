import path from 'node:path';
import { MemoryFileSystem } from '@fleet/core';
import { describe, expect, it } from 'vitest';
import { FakeCodeGraphAdapter } from '../codegraph/fake-adapter.js';
import type { SymbolHit } from '../codegraph/contract.js';
import { investigate } from './investigate.js';
import type { CodeGraphMaintainer } from '../codegraph/maintainer.js';
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
    const staleEvents: Array<{ code: string; pendingChanges?: number }> = [];
    const result = await investigate('targetFunc', {
      ...makeOptions({
        health: {
          available: true,
          initialized: true,
          indexFresh: false,
          pendingChanges: 3,
          capabilities: ['search'],
        },
      }),
      emitEvent: (event) => {
        if (event.type === 'codegraph.fallback') {
          staleEvents.push(
            event.payload as { code: string; pendingChanges?: number },
          );
        }
      },
    });
    const stale = result.fallbacks.find((reason) => reason.code === 'stale');
    expect(stale?.detail).toContain('3 个文件比索引新');
    expect(stale?.fixSuggestion).toContain('codegraph sync');
    expect(result.references.length).toBeGreaterThan(0);
    // M11 回归：stale 降级必须发 codegraph.fallback 事件（含落后文件数）
    expect(staleEvents.map((event) => event.code)).toContain('stale');
    expect(
      staleEvents.find((event) => event.code === 'stale')?.pendingChanges,
    ).toBe(3);
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

describe('specs/014：CodeGraph 自动维护策略矩阵', () => {
  const STALE = {
    available: true,
    initialized: true,
    indexFresh: false,
    pendingChanges: 3,
    capabilities: ['search'],
  } as const;
  const UNINIT = {
    available: true,
    initialized: false,
    indexFresh: false,
    pendingChanges: 0,
    capabilities: [],
  } as const;
  const FRESH = {
    available: true,
    initialized: true,
    indexFresh: true,
    pendingChanges: 0,
    capabilities: ['search'],
  } as const;

  /** 维护成功即改写 adapter 健康（模拟真实 sync 后索引新鲜） */
  function healingMaintainer(
    adapter: FakeCodeGraphAdapter,
    outcome: { ok: boolean; kind?: 'failed' | 'timeout'; detail?: string },
  ): CodeGraphMaintainer & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      async init() {
        calls.push('init');
        if (outcome.ok) {
          adapter.setHealth(FRESH);
        }
        return outcome.ok
          ? { ok: true, durationMs: 5 }
          : {
              ok: false,
              kind: outcome.kind ?? 'failed',
              detail: outcome.detail ?? 'fake 失败',
              durationMs: 5,
            };
      },
      async sync() {
        calls.push('sync');
        if (outcome.ok) {
          adapter.setHealth(FRESH);
        }
        return outcome.ok
          ? { ok: true, durationMs: 5 }
          : {
              ok: false,
              kind: outcome.kind ?? 'failed',
              detail: outcome.detail ?? 'fake 失败',
              durationMs: 5,
            };
      },
    };
  }

  it('SC-001 manual 档：stale 零维护零变化（现状路径）', async () => {
    const adapter = new FakeCodeGraphAdapter({ health: STALE });
    const m = healingMaintainer(adapter, { ok: true });
    const result = await investigate('targetFunc', {
      ...makeOptions({}),
      adapter,
      codegraph: { policy: 'manual', maintainer: m },
    });
    expect(m.calls).toHaveLength(0);
    expect(result.pathsUsed).not.toContain('codegraph');
    expect(codes(result.fallbacks)).toContain('stale');
  });

  it('SC-001 sync 档：stale → 恰一次 sync → 重查命中 codegraph', async () => {
    const adapter = new FakeCodeGraphAdapter({ health: STALE });
    const m = healingMaintainer(adapter, { ok: true });
    const events: string[] = [];
    const result = await investigate('targetFunc', {
      ...makeOptions({}),
      adapter,
      emitEvent: (event) => events.push(event.type),
      codegraph: { policy: 'sync', maintainer: m },
    });
    expect(m.calls).toEqual(['sync']);
    expect(result.pathsUsed).toContain('codegraph');
    expect(result.fallbacks.filter((f) => f.code === 'stale')).toHaveLength(0);
    expect(events).toContain('codegraph.sync.started');
    expect(events).toContain('codegraph.sync.completed');
  });

  it('SC-001 auto 档：uninitialized → 恰一次 init → 命中；sync 档不越档 init', async () => {
    const adapter = new FakeCodeGraphAdapter({ health: UNINIT });
    const m = healingMaintainer(adapter, { ok: true });
    const result = await investigate('targetFunc', {
      ...makeOptions({}),
      adapter,
      codegraph: { policy: 'auto', maintainer: m },
    });
    expect(m.calls).toEqual(['init']);
    expect(result.pathsUsed).toContain('codegraph');

    const adapter2 = new FakeCodeGraphAdapter({ health: UNINIT });
    const m2 = healingMaintainer(adapter2, { ok: true });
    const result2 = await investigate('targetFunc', {
      ...makeOptions({}),
      adapter: adapter2,
      codegraph: { policy: 'sync', maintainer: m2 },
    });
    expect(m2.calls).toHaveLength(0); // sync 档不 init（越档禁止）
    expect(result2.pathsUsed).not.toContain('codegraph');
    const uninit = result2.fallbacks.find((f) => f.code === 'uninitialized');
    expect(uninit?.fixSuggestion).toContain('auto');
  });

  it('SC-002 维护失败/超时 → 降级完成 + fallback 含尝试信息（调查不失败）', async () => {
    for (const outcome of [
      { ok: false as const, kind: 'failed' as const, detail: 'sync 崩了' },
      { ok: false as const, kind: 'timeout' as const, detail: '超时' },
    ]) {
      const adapter = new FakeCodeGraphAdapter({ health: STALE });
      const m = healingMaintainer(adapter, outcome);
      const events: string[] = [];
      const result = await investigate('targetFunc', {
        ...makeOptions({}),
        adapter,
        emitEvent: (event) => events.push(event.type),
        codegraph: { policy: 'sync', maintainer: m },
      });
      expect(result.references.length).toBeGreaterThanOrEqual(1); // 降级仍出结果
      expect(result.pathsUsed).not.toContain('codegraph');
      const stale = result.fallbacks.find((f) => f.code === 'stale');
      expect(stale?.detail).toContain(`已尝试自动 sync：${outcome.kind}`);
      expect(events).toContain('codegraph.sync.started');
      expect(events).toContain('codegraph.sync.failed');
    }
  });

  it('SC-003 单次语义：维护成功但重查仍 stale → 直接降级，不二次 sync', async () => {
    const adapter = new FakeCodeGraphAdapter({ health: STALE });
    const m: CodeGraphMaintainer & { calls: string[] } = {
      calls: [],
      async init() {
        throw new Error('不应触发 init');
      },
      async sync() {
        m.calls.push('sync');
        return { ok: true, durationMs: 5 }; // 成功但不 heal（重查仍 stale）
      },
    };
    const result = await investigate('targetFunc', {
      ...makeOptions({}),
      adapter,
      codegraph: { policy: 'auto', maintainer: m },
    });
    expect(m.calls).toHaveLength(1); // 恰一次——重查不新鲜不再试
    expect(result.pathsUsed).not.toContain('codegraph');
    const stale = result.fallbacks.find((f) => f.code === 'stale');
    expect(stale?.detail).toContain('完成但索引仍不新鲜');
  });

  it('SC-005 unavailable × 三档：零维护调用', async () => {
    for (const policy of ['manual', 'sync', 'auto'] as const) {
      const adapter = new FakeCodeGraphAdapter({
        health: {
          available: false,
          initialized: false,
          indexFresh: false,
          pendingChanges: 0,
          capabilities: [],
        },
      });
      const m = healingMaintainer(adapter, { ok: true });
      const result = await investigate('targetFunc', {
        ...makeOptions({}),
        adapter,
        codegraph: { policy, maintainer: m },
      });
      expect(m.calls, policy).toHaveLength(0);
      expect(result.pathsUsed).not.toContain('codegraph');
    }
  });

  it('缺省（不传 codegraph 段）= manual 现状', async () => {
    const result = await investigate('targetFunc', makeOptions({}));
    expect(result.pathsUsed).toContain('codegraph'); // Fake 默认健康
  });
});
