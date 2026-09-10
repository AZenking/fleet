/**
 * 公共 API 导出面（高风险矩阵夹具：public_api 规则锚定对象）。
 */

export interface PublicApiEntry {
  route: string;
  method: 'GET' | 'POST';
}

export const PUBLIC_API: PublicApiEntry[] = [
  { route: '/payments', method: 'POST' },
  { route: '/invoices', method: 'GET' },
];

export function listPublicApi(): PublicApiEntry[] {
  return [...PUBLIC_API];
}
