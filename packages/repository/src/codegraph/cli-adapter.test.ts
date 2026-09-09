import { execa } from 'execa';
import { beforeAll, describe, expect, it } from 'vitest';
import { CodeGraphCliAdapter } from './cli-adapter.js';
import { FakeCodeGraphAdapter, HEALTHY_FAKE_HEALTH } from './fake-adapter.js';
import { toCodeGraphHealth } from './health.js';

const repoRoot = new URL('../../../', import.meta.url).pathname;

describe('CodeGraphCliAdapter（真实 CLI，codegraph 缺失时跳过）', () => {
  let hasCodegraph = false;

  beforeAll(async () => {
    try {
      await execa('codegraph', ['--version'], { reject: false });
      hasCodegraph = true;
    } catch {
      hasCodegraph = false;
    }
  });

  it('health()：本仓库已建索引 → available 且 initialized', async (context) => {
    if (!hasCodegraph) {
      context.skip();
    }
    const adapter = new CodeGraphCliAdapter({ repoRoot });
    const health = await adapter.health();
    expect(health.available).toBe(true);
    expect(health.initialized).toBe(true);
  });

  it('symbol()：loadFleetConfig 命中 loader.ts', async (context) => {
    if (!hasCodegraph) {
      context.skip();
    }
    const adapter = new CodeGraphCliAdapter({ repoRoot });
    const result = await adapter.symbol('loadFleetConfig');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const exact = result.value.filter(
        (hit) => hit.name === 'loadFleetConfig',
      );
      expect(exact.length).toBeGreaterThanOrEqual(1);
      expect(
        exact.some((hit) =>
          hit.filePath.includes('packages/core/src/config/loader.ts'),
        ),
      ).toBe(true);
    }
  });

  it('callers()：返回结构化边', async (context) => {
    if (!hasCodegraph) {
      context.skip();
    }
    const adapter = new CodeGraphCliAdapter({ repoRoot });
    const result = await adapter.callers('loadFleetConfig');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Array.isArray(result.value)).toBe(true);
    }
  });

  it('命令不存在 → unavailable（不抛异常）', async () => {
    const adapter = new CodeGraphCliAdapter({
      repoRoot,
      command: 'definitely-not-codegraph',
    });
    const result = await adapter.symbol('anything');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('unavailable');
    }
  });
});

describe('FakeCodeGraphAdapter（行为契约）', () => {
  it('默认健康且各方法返回空成功', async () => {
    const adapter = new FakeCodeGraphAdapter();
    expect(await adapter.health()).toEqual(HEALTHY_FAKE_HEALTH);
    const result = await adapter.symbol('x');
    expect(result).toEqual({ ok: true, value: [] });
  });

  it('脚本化失败也走 { ok: false } 返回路径', async () => {
    const adapter = new FakeCodeGraphAdapter({
      symbol: { ok: false, failure: { code: 'timeout', detail: '模拟超时' } },
    });
    const result = await adapter.symbol('x');
    expect(result).toEqual({
      ok: false,
      failure: { code: 'timeout', detail: '模拟超时' },
    });
  });
});

describe('toCodeGraphHealth（stale 判定，research.md D4）', () => {
  const fresh = {
    initialized: true,
    version: '1.4.1',
    pendingChanges: { added: 0, modified: 0, removed: 0 },
    index: { reindexRecommended: false, state: 'complete' },
  };

  it('全部干净 → indexFresh', () => {
    expect(toCodeGraphHealth(fresh).indexFresh).toBe(true);
  });

  it('pendingChanges > 0 → stale', () => {
    expect(
      toCodeGraphHealth({
        ...fresh,
        pendingChanges: { added: 0, modified: 3, removed: 0 },
      }).indexFresh,
    ).toBe(false);
  });

  it('未初始化 → stale', () => {
    expect(toCodeGraphHealth({ ...fresh, initialized: false }).indexFresh).toBe(
      false,
    );
  });

  it('reindexRecommended → stale', () => {
    expect(
      toCodeGraphHealth({
        ...fresh,
        index: { reindexRecommended: true, state: 'complete' },
      }).indexFresh,
    ).toBe(false);
  });

  it('非法结构 → available 但视为不可信', () => {
    const health = toCodeGraphHealth('garbage');
    expect(health.indexFresh).toBe(false);
  });
});
