import { describe, expect, it } from 'vitest';

import { evaluateConfidence } from './confidence.js';
import { detectVerifyRisk, resolveMode, withEscalation } from './rules.js';
import type { Evidence, EvidenceConflict } from './types.js';

/**
 * Foundational 矩阵测试（tasks.md T006）：模式裁决 × 高风险表 ×
 * 置信度规则表全分支（research.md D2/D6）。
 */

function evidence(source: Evidence['source'], verified: boolean): Evidence {
  return {
    source,
    location: `src/x.ts:${verified ? 1 : 2}`,
    excerpt: 'export const X = 1;',
    verified,
  };
}

const CONFLICT: EvidenceConflict = {
  kind: 'anchor_offset',
  accelerated: {
    source: 'codegraph',
    location: 'src/x.ts:99',
    claim: '符号在 99 行',
  },
  truth: { location: 'src/x.ts:1', fact: '符号实际在 1 行' },
  winner: 'static_truth',
  reason: '源码胜出',
};

describe('detectVerifyRisk（高风险六类规则表）', () => {
  it.each([
    ['payment', '支付 charge 逻辑在哪'],
    ['payment', '删除 PaymentService 的影响'],
    ['authentication', '认证 login 流程'],
    ['authentication', 'token 怎么签发'],
    ['db_schema', 'DB schema 迁移在哪定义'],
    ['db_schema', 'migration 脚本在哪'],
    ['public_api', '公共 api 导出了什么'],
    ['public_api', '删除 api 接口影响'],
    ['service', '删除 service 的调用方'],
    ['large_refactor', '大范围重构的入口'],
    ['large_refactor', 'refactor 计划在哪'],
  ])('问题命中 %s 规则', (rule, question) => {
    const matches = detectVerifyRisk({ question });
    expect(matches.some((match) => match.rule === rule)).toBe(true);
  });

  it('路径命中：schema / payment / auth 文件路径升级', () => {
    const matches = detectVerifyRisk({
      question: '结构说明',
      filePaths: ['db/schema.ts', 'src/payment.ts', 'src/auth.ts'],
    });
    const rules = matches.map((match) => match.rule);
    expect(rules).toContain('db_schema');
    expect(rules).toContain('payment');
    expect(rules).toContain('authentication');
  });

  it('日常导航问题不命中（无误报）', () => {
    expect(
      detectVerifyRisk({ question: 'loadFleetConfig 在哪里定义' }),
    ).toEqual([]);
    expect(detectVerifyRisk({ question: 'FleetError 错误模型' })).toEqual([]);
  });

  it('词边界：schema-like 单词不误伤（不包含 schema 的词不命中）', () => {
    // "schemas" 命中（包含 schema 词根）；普通词不命中
    expect(detectVerifyRisk({ question: 'schemas 在哪' }).length).toBe(1);
    expect(detectVerifyRisk({ question: '普通问题' })).toEqual([]);
  });
});

describe('resolveMode（模式矩阵）', () => {
  const RISK = [{ rule: 'payment', detail: '命中高风险表：payment' }];

  it('auto：无风险 → fast；有风险 → verify + high_risk 升级', () => {
    expect(resolveMode('auto', []).effectiveMode).toBe('fast');
    const escalated = resolveMode('auto', RISK);
    expect(escalated.effectiveMode).toBe('verify');
    expect(escalated.escalations.map((item) => item.rule)).toContain(
      'high_risk',
    );
  });

  it('fast：显式 fast 不豁免高风险（FR-005）', () => {
    const escalated = resolveMode('fast', RISK);
    expect(escalated.effectiveMode).toBe('verify');
    expect(escalated.escalations).toHaveLength(1);
  });

  it('fast：无风险保持 fast，无升级记录', () => {
    const mode = resolveMode('fast', []);
    expect(mode.effectiveMode).toBe('fast');
    expect(mode.escalations).toEqual([]);
  });

  it('verify：恒 verify，高风险不再重复记升级', () => {
    const mode = resolveMode('verify', RISK);
    expect(mode.effectiveMode).toBe('verify');
    expect(mode.escalations).toEqual([]);
  });

  it('withEscalation：编排期升级（zero_hits / accelerators_unavailable）', () => {
    const mode = withEscalation(
      resolveMode('auto', []),
      'zero_hits',
      '加速源零命中，自动走 VERIFY 全链',
    );
    expect(mode.effectiveMode).toBe('verify');
    expect(mode.escalations[0]).toEqual({
      rule: 'zero_hits',
      detail: '加速源零命中，自动走 VERIFY 全链',
    });
  });
});

describe('evaluateConfidence（规则表全分支）', () => {
  it('零证据 → low（insufficient）', () => {
    const outcome = evaluateConfidence({
      evidence: [],
      conflicts: [],
      mode: 'verify',
    });
    expect(outcome.confidence).toBe('low');
    expect(outcome.reason).toContain('insufficient');
  });

  it('未决冲突 → low（即使多源 verified）', () => {
    const outcome = evaluateConfidence({
      evidence: [evidence('source', true), evidence('config', true)],
      conflicts: [CONFLICT],
      mode: 'verify',
    });
    expect(outcome.confidence).toBe('low');
    expect(outcome.reason).toContain('冲突');
  });

  it('全部未复核（fast 加速源）→ low', () => {
    const outcome = evaluateConfidence({
      evidence: [evidence('codegraph', false), evidence('wiki', true)],
      conflicts: [],
      mode: 'fast',
    });
    expect(outcome.confidence).toBe('low');
    expect(outcome.reason).toContain('未经源码/配置复核');
  });

  it('fast 模式封顶 medium（有 Static Truth 也不到 high）', () => {
    const outcome = evaluateConfidence({
      evidence: [evidence('source', true)],
      conflicts: [],
      mode: 'fast',
    });
    expect(outcome.confidence).toBe('medium');
    expect(outcome.reason).toContain('fast 模式封顶');
  });

  it('verified 多源一致（verify）→ high', () => {
    const outcome = evaluateConfidence({
      evidence: [evidence('source', true), evidence('config', true)],
      conflicts: [],
      mode: 'verify',
    });
    expect(outcome.confidence).toBe('high');
    expect(outcome.reason).toContain('多源一致');
  });

  it('单源 verified（verify）→ medium', () => {
    const outcome = evaluateConfidence({
      evidence: [evidence('source', true)],
      conflicts: [],
      mode: 'verify',
    });
    expect(outcome.confidence).toBe('medium');
    expect(outcome.reason).toContain('单源');
  });

  it('同输入同输出（SC-003 确定性）', () => {
    const input = {
      evidence: [evidence('source', true), evidence('search', true)],
      conflicts: [],
      mode: 'verify' as const,
    };
    expect(evaluateConfidence(input)).toEqual(evaluateConfidence(input));
  });
});
