import { describe, expect, it } from 'vitest';
import type { SymbolHit } from '../codegraph/contract.js';
import { detectHighRisk, validateSymbolHits } from './policy.js';

function hit(filePath: string, startLine: number): SymbolHit {
  return {
    name: 'Logger',
    kind: 'class',
    filePath,
    startLine,
    endLine: startLine + 3,
  };
}

describe('validateSymbolHits', () => {
  it('0 命中 → missing_symbol', () => {
    const verdict = validateSymbolHits([], 'Logger');
    expect(verdict.action).toBe('escalate');
    if (verdict.action === 'escalate') {
      expect(verdict.reason.code).toBe('missing_symbol');
    }
  });

  it('唯一命中 → accept', () => {
    expect(validateSymbolHits([hit('src/a.ts', 1)], 'Logger').action).toBe(
      'accept',
    );
  });

  it('同名多处 → ambiguous，detail 列出全部位置', () => {
    const verdict = validateSymbolHits(
      [hit('src/a.ts', 1), hit('src/b.ts', 5)],
      'Logger',
    );
    expect(verdict.action).toBe('escalate');
    if (verdict.action === 'escalate') {
      expect(verdict.reason.code).toBe('ambiguous');
      expect(verdict.reason.detail).toContain('src/a.ts:1');
      expect(verdict.reason.detail).toContain('src/b.ts:5');
    }
  });
});

describe('detectHighRisk（FR-007）', () => {
  it('关键词命中（配置驱动）', () => {
    expect(detectHighRisk({ keywords: ['配置驱动'] })).toBe(true);
  });

  it('英文关键词命中（reflection）', () => {
    expect(detectHighRisk({ keywords: ['Reflection'] })).toBe(true);
  });

  it('生成代码路径 / @generated 标记', () => {
    expect(detectHighRisk({ filePath: 'src/generated-api.ts' })).toBe(true);
    expect(detectHighRisk({ snippet: '// @generated — do not edit' })).toBe(
      true,
    );
  });

  it('配置文件路径', () => {
    expect(detectHighRisk({ filePath: 'config/rates.yaml' })).toBe(true);
  });

  it('拉丁关键词按词边界匹配：perf_hooks 不触发，独立词触发', () => {
    expect(
      detectHighRisk({
        snippet: "import { performance } from 'node:perf_hooks'",
      }),
    ).toBe(false);
    expect(detectHighRisk({ snippet: 'container.register(MyService)' })).toBe(
      true,
    );
    expect(detectHighRisk({ snippet: 'eval(expr)' })).toBe(true);
  });

  it('普通代码 → 不升级', () => {
    expect(
      detectHighRisk({
        filePath: 'src/payment.ts',
        snippet: 'export const x = 1',
      }),
    ).toBe(false);
  });
});
