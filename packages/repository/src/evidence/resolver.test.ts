import { describe, expect, it } from 'vitest';

import type { Reference } from '../investigation/types.js';
import { resolveFindings, toEvidence } from './resolver.js';
import type { EvidenceConflict } from './types.js';

/**
 * resolver 单元测试（tasks.md T010）：分组确定性 / 模板文案 /
 * config 重分类 / 上限截断 / insufficient（research.md D1/D5）。
 */

function ref(input: Partial<Reference> & { filePath: string }): Reference {
  return {
    startLine: 1,
    endLine: 1,
    snippet: 'export const X = 1;',
    origin: 'source',
    verified: true,
    ...input,
  };
}

const CONFLICT: EvidenceConflict = {
  kind: 'anchor_offset',
  accelerated: {
    source: 'codegraph',
    location: 'src/a.ts:99',
    claim: 'X 位于 99 行',
  },
  truth: { location: 'src/a.ts:2', fact: 'export const X = 1;' },
  winner: 'static_truth',
  reason: '锚点与源码不一致，已按源码修正',
};

describe('toEvidence（config 重分类，D5）', () => {
  it('yaml/json 命中 → source=config；普通源码 → source=source', () => {
    expect(toEvidence(ref({ filePath: 'config/rates.yaml' })).source).toBe(
      'config',
    );
    expect(toEvidence(ref({ filePath: 'pkg/config.json' })).source).toBe(
      'config',
    );
    expect(toEvidence(ref({ filePath: 'src/a.ts' })).source).toBe('source');
    expect(
      toEvidence(ref({ filePath: 'src/a.ts', origin: 'codegraph' })).source,
    ).toBe('codegraph');
  });

  it('verified 语义透传（fast 的 codegraph 证据保持 false）', () => {
    expect(
      toEvidence(
        ref({ filePath: 'src/a.ts', origin: 'codegraph', verified: false }),
      ).verified,
    ).toBe(false);
  });
});

describe('resolveFindings（模板与分组）', () => {
  it('符号 finding：planner 符号顺序、模板文案、首处位置', () => {
    const findings = resolveFindings({
      symbols: ['PaymentService', 'Logger'],
      references: [
        ref({
          filePath: 'src/payment.ts',
          startLine: 8,
          symbol: 'PaymentService',
        }),
        ref({ filePath: 'src/logging.ts', startLine: 3, symbol: 'Logger' }),
        ref({ filePath: 'src/notify.ts', startLine: 4, symbol: 'Logger' }),
      ],
      mode: 'verify',
    });
    expect(findings.map((finding) => finding.kind)).toEqual([
      'symbol',
      'symbol',
    ]);
    expect(findings[0]?.statement).toBe(
      '「PaymentService」共 1 处引用（首处 src/payment.ts:8）',
    );
    expect(findings[1]?.statement).toContain('共 2 处引用');
    expect(findings[1]?.evidence).toHaveLength(2);
  });

  it('文件组 finding：剩余引用按顶层目录归组、字典序', () => {
    const findings = resolveFindings({
      symbols: [],
      references: [
        ref({ filePath: 'packages/beta/x.ts' }),
        ref({ filePath: 'apps/cli/y.ts' }),
        ref({ filePath: 'packages/beta/z.ts' }),
      ],
      mode: 'verify',
    });
    const clusters = findings.filter((f) => f.kind === 'file-cluster');
    expect(clusters.map((f) => f.statement)).toEqual([
      '关键词在 apps 命中 1 处',
      '关键词在 packages 命中 2 处',
    ]);
  });

  it('wiki finding：页面去重计数 + 路径列举；死路径冲突挂靠', () => {
    const deadPath: EvidenceConflict = {
      ...CONFLICT,
      kind: 'dead_path',
      accelerated: {
        source: 'wiki',
        location: 'domains/core.md',
        claim: 'wiki 称存在 packages/ghost/src/x.ts',
      },
      truth: { location: '（磁盘）', fact: 'packages/ghost/src/x.ts 不存在' },
    };
    const findings = resolveFindings({
      symbols: [],
      references: [],
      wikiEvidence: [
        {
          source: 'wiki',
          location: 'domains/core.md',
          excerpt: 'core 模块',
          verified: true,
        },
        {
          source: 'wiki',
          location: 'domains/core.md',
          excerpt: '再次命中',
          verified: true,
        },
      ],
      wikiConflicts: [deadPath],
      mode: 'verify',
    });
    const wiki = findings.find((f) => f.kind === 'wiki');
    expect(wiki?.statement).toContain('1 页与问题相关（domains/core.md）');
    expect(wiki?.conflicts).toEqual([deadPath]);
  });

  it('insufficient：零证据不产出无据 statement（FR-009）', () => {
    const findings = resolveFindings({
      symbols: ['Nothing'],
      references: [],
      mode: 'verify',
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe('insufficient');
    expect(findings[0]?.evidence).toEqual([]);
    expect(findings[0]?.confidence).toBe('low');
  });

  it('evidence 上限 10 条 + truncated 标注（FR-010）', () => {
    const references = Array.from({ length: 15 }, (_, index) =>
      ref({ filePath: 'src/a.ts', startLine: index + 1, symbol: 'Big' }),
    );
    const findings = resolveFindings({
      symbols: ['Big'],
      references,
      mode: 'verify',
    });
    expect(findings[0]?.evidence).toHaveLength(10);
    expect(findings[0]?.truncated).toBe(true);
  });

  it('锚点冲突挂靠到包含该文件的 finding', () => {
    const findings = resolveFindings({
      symbols: ['X'],
      references: [ref({ filePath: 'src/a.ts', startLine: 2, symbol: 'X' })],
      anchorConflicts: [
        { filePath: 'src/a.ts', symbol: 'X', conflict: CONFLICT },
      ],
      mode: 'verify',
    });
    expect(findings[0]?.conflicts).toEqual([CONFLICT]);
    expect(findings[0]?.confidence).toBe('low');
  });

  it('同输入同输出（SC-003 分组确定性）', () => {
    const input = {
      symbols: ['X'],
      references: [ref({ filePath: 'src/a.ts', symbol: 'X' })],
      mode: 'verify' as const,
    };
    expect(resolveFindings(input)).toEqual(resolveFindings(input));
  });
});
