import { DEFAULT_PRICES, type PriceTable, type UsageInput } from './types.js';

/**
 * 估算口径（research.md D5）：字符 → token 的固定系数换算，
 * 零依赖（不引入 tokenizer，宪法 VI）。单一来源——context 的
 * section 尺寸与 budget 的 contextSize 复算共用本函数，全链一致。
 */

export const DEFAULT_CHARS_PER_TOKEN = 4;

export function estimateTokens(
  text: string,
  charsPerToken: number = DEFAULT_CHARS_PER_TOKEN,
): number {
  if (charsPerToken <= 0) {
    throw new RangeError(`非法换算系数：${charsPerToken}（应 > 0）`);
  }
  return Math.ceil(text.length / charsPerToken);
}

export function estimateCost(
  usage: UsageInput,
  prices: PriceTable = DEFAULT_PRICES,
): number {
  const input = (usage.inputTokens / 1_000_000) * prices.inputPerMillion;
  const output = (usage.outputTokens / 1_000_000) * prices.outputPerMillion;
  const cached = (usage.cachedTokens / 1_000_000) * prices.cachedPerMillion;
  return round(input + output + cached);
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
