import { matchesKeyword } from '../investigation/policy.js';
import type {
  EffectiveMode,
  ModeEscalation,
  ModeEscalationRule,
  ModeResolution,
  RequestedMode,
} from './types.js';

/**
 * 模式裁决（research.md D2 / FR-004/005/011）：
 * auto 默认；fast 不豁免高风险；verify 恒定。
 * 高风险语义表在 M1 引用级 detectHighRisk 之外独立——模式级升级是
 * 新职责，M1 行为零改动。
 */

export interface HighRiskMatch {
  /** 命中的规则名（payment / authentication / db_schema / public_api / service / large_refactor） */
  rule: string;
  detail: string;
}

interface RiskRule {
  rule: string;
  keywords: string[];
  /** 命中任一路径正则亦升级（保守方向：多升不错过） */
  pathPatterns?: RegExp[];
}

const VERIFY_RISK_RULES: RiskRule[] = [
  {
    rule: 'payment',
    keywords: [
      'payment',
      'billing',
      'charge',
      'invoice',
      '支付',
      '扣款',
      '账单',
    ],
    pathPatterns: [/payment|billing/i],
  },
  {
    rule: 'authentication',
    keywords: ['auth', 'login', 'token', 'session', '认证', '登录', '鉴权'],
    pathPatterns: [/(^|\/)auth/i],
  },
  {
    rule: 'db_schema',
    keywords: ['schema', 'migration', '数据库结构', '表结构', '迁移'],
    pathPatterns: [/schema|migrations?\//i],
  },
  {
    rule: 'public_api',
    keywords: [
      '公共 api',
      '公共api',
      'public api',
      'api 删除',
      '删除 api',
      '删除接口',
      '移除接口',
      '导出面',
    ],
    pathPatterns: [/(^|\/)api\//i],
  },
  {
    rule: 'service',
    keywords: ['service 删除', '删除 service', '服务删除', 'decommission'],
  },
  {
    rule: 'large_refactor',
    keywords: ['大范围', '重构', 'refactor', 'restructure', '重写整个'],
  },
];

export interface VerifyRiskInput {
  /** 问题关键词（planner 产出） */
  keywords?: string[];
  /** 候选引用的文件路径（路径规则输入） */
  filePaths?: string[];
  /** 原始问题文本（整句兜底匹配） */
  question?: string;
}

/** 模式级高风险判定：确定性规则表（FR-011），命中即强制 VERIFY */
export function detectVerifyRisk(input: VerifyRiskInput): HighRiskMatch[] {
  const haystacks: string[] = [...(input.keywords ?? []), input.question ?? ''];
  const matches: HighRiskMatch[] = [];
  for (const rule of VERIFY_RISK_RULES) {
    const keywordHit = rule.keywords.some((keyword) =>
      haystacks.some((haystack) =>
        matchesKeyword(haystack.toLowerCase(), keyword.toLowerCase()),
      ),
    );
    const pathHit =
      rule.pathPatterns?.some((pattern) =>
        (input.filePaths ?? []).some((filePath) => pattern.test(filePath)),
      ) === true;
    if (keywordHit || pathHit) {
      matches.push({
        rule: rule.rule,
        detail: keywordHit
          ? `命中高风险表：${rule.rule}（关键词匹配）`
          : `命中高风险表：${rule.rule}（路径匹配）`,
      });
    }
  }
  return matches;
}

/**
 * 模式裁决：requested + 高风险表 → effective。
 * auto：高风险 → verify，否则 fast；fast：高风险仍 verify（FR-005
 * 显式不豁免）；verify 恒 verify。
 */
export function resolveMode(
  requested: RequestedMode,
  highRisk: HighRiskMatch[],
): ModeResolution {
  const escalations: ModeEscalation[] = [];
  if (highRisk.length > 0 && requested !== 'verify') {
    escalations.push({
      rule: 'high_risk',
      detail: `${highRisk.map((match) => match.detail).join('；')}`,
    });
  }
  const effectiveMode: EffectiveMode =
    requested === 'verify' || highRisk.length > 0 ? 'verify' : 'fast';
  return { requestedMode: requested, effectiveMode, escalations };
}

/** 编排期追加上升记录（zero_hits / accelerators_unavailable，research.md D3） */
export function withEscalation(
  mode: ModeResolution,
  rule: ModeEscalationRule,
  detail: string,
): ModeResolution {
  return {
    ...mode,
    effectiveMode: 'verify',
    escalations: [...mode.escalations, { rule, detail }],
  };
}
