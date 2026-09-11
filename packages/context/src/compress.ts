import { estimateTokens } from '@fleet/budget';

import type { ContextSection } from './types.js';

/**
 * 规则压缩（research.md D7，零 LLM——宪法 V）：每轮从**原始内容**
 * 按累计保留比例截断（轮 1 → 50%，轮 2 → 25%——逐级加深，轮间
 * 不叠加误差）；头尾各半保留 + truncation marker（错误/结论通常
 * 在尾部）；同输入同输出。轮内全量复检；轮次耗尽仍超 → fits=false。
 */

export const TRUNCATION_MARKER = '[…context truncated…]';

export interface CompressionResult {
  fits: boolean;
  sections: ContextSection[];
  rounds: number;
}

export function compressSections(
  sections: ContextSection[],
  limit: number,
  maxRounds: number,
  charsPerToken: number,
): CompressionResult {
  const originals = sections.map((section) => ({
    section,
    original: section.content,
  }));
  for (let round = 1; round <= maxRounds; round += 1) {
    const keepRatio = 0.5 ** round;
    const current = originals.map(({ section, original }) =>
      section.unavailable
        ? section
        : truncateFrom(section, original, keepRatio, charsPerToken),
    );
    if (totalOf(current) <= limit) {
      return { fits: true, sections: current, rounds: round };
    }
    if (round === maxRounds) {
      return { fits: false, sections: current, rounds: maxRounds };
    }
  }
  return { fits: false, sections, rounds: 0 };
}

/** 从原始内容按保留比例截断（头尾各半） */
function truncateFrom(
  section: ContextSection,
  original: string,
  keepRatio: number,
  charsPerToken: number,
): ContextSection {
  const keepChars = Math.max(
    0,
    Math.floor(original.length * keepRatio) - TRUNCATION_MARKER.length,
  );
  if (keepChars >= original.length) {
    return section; // 原文已在保留额度内
  }
  const half = Math.floor(keepChars / 2);
  const candidate = `${original.slice(0, half)}\n${TRUNCATION_MARKER}\n${original.slice(original.length - half)}`;
  // 截断不得反向膨胀：候选不小于原文（小节）则保持原文
  if (candidate.length >= original.length) {
    return section;
  }
  return {
    ...section,
    content: candidate,
    sizeTokens: estimateTokens(candidate, charsPerToken),
    truncated: true,
  };
}

function totalOf(sections: ContextSection[]): number {
  return sections.reduce((sum, section) => sum + section.sizeTokens, 0);
}
