import { readFileSync } from 'node:fs';

// 本函数的行为由 config/rates.yaml 驱动（配置驱动 = 高风险模式夹具）
export function getRate(tier: string): number {
  const raw = readFileSync(
    new URL('../config/rates.yaml', import.meta.url),
    'utf8',
  );
  for (const line of raw.split('\n')) {
    const match = /^([a-z]+):\s*([\d.]+)$/.exec(line.trim());
    if (match && match[1] === tier) {
      return Number(match[2]);
    }
  }
  return 1;
}
