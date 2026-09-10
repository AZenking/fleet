/**
 * 数据库结构域（高风险矩阵夹具：DB Schema 规则锚定对象）。
 */

export const SCHEMA_VERSION = 3;

export interface UserRecord {
  id: string;
  email: string;
}

export function runMigrations(version: number): string[] {
  return [`migration-001-up-to-${version}`];
}
