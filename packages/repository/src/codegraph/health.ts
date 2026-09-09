import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { CodeGraphHealth } from './contract.js';

/**
 * status --json → CodeGraphHealth（research.md D4）。
 *
 * stale 判定两层：
 * 1. status 自身：!initialized || pendingChanges>0 || reindexRecommended
 *    || index.state!=='complete'
 * 2. 文件漂移（实测补充）：codegraph status 不检测实时修改，
 *    需对比文件 mtime 与 lastIndexed——发现更新的文件即视为 stale。
 */

const rawStatusSchema = z.looseObject({
  initialized: z.boolean(),
  version: z.string().optional(),
  lastIndexed: z.string().optional(),
  pendingChanges: z
    .object({
      added: z.number().default(0),
      modified: z.number().default(0),
      removed: z.number().default(0),
    })
    .optional(),
  index: z
    .looseObject({
      reindexRecommended: z.boolean().optional(),
      state: z.string().optional(),
    })
    .optional(),
});

export const CODEGRAPH_CAPABILITIES = [
  'search',
  'symbol',
  'callers',
  'callees',
  'impact',
  'explore',
] as const;

export const UNAVAILABLE_HEALTH: CodeGraphHealth = {
  available: false,
  initialized: false,
  indexFresh: false,
  pendingChanges: 0,
  capabilities: [],
};

export function toCodeGraphHealth(raw: unknown): CodeGraphHealth {
  const parsed = rawStatusSchema.safeParse(raw);
  if (!parsed.success) {
    return { ...UNAVAILABLE_HEALTH, available: true };
  }
  const status = parsed.data;
  const pending =
    (status.pendingChanges?.added ?? 0) +
    (status.pendingChanges?.modified ?? 0) +
    (status.pendingChanges?.removed ?? 0);
  const indexFresh =
    status.initialized &&
    pending === 0 &&
    (status.index?.reindexRecommended ?? false) === false &&
    (status.index?.state ?? 'complete') === 'complete';
  return {
    available: true,
    initialized: status.initialized,
    version: status.version,
    indexFresh,
    pendingChanges: pending,
    capabilities: [...CODEGRAPH_CAPABILITIES],
  };
}

export function extractLastIndexed(raw: unknown): string | undefined {
  const parsed = rawStatusSchema.safeParse(raw);
  return parsed.success ? parsed.data.lastIndexed : undefined;
}

const FRESHNESS_EXCLUDED = new Set([
  '.git',
  '.codegraph',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.fleet',
]);

/**
 * 统计 mtime 晚于 lastIndexed 的文件数（上限 cap，超限即返回 cap）。
 * 真实适配器专用（node:fs 直读）；测试可对临时目录验证。
 */
export function countFilesNewerThan(
  repoRoot: string,
  isoTimestamp: string,
  cap = 50,
): number {
  const threshold = Date.parse(isoTimestamp);
  if (Number.isNaN(threshold)) {
    return 0;
  }
  let count = 0;
  const visit = (dir: string): void => {
    if (count >= cap) {
      return;
    }
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (count >= cap) {
        return;
      }
      if (FRESHNESS_EXCLUDED.has(entry)) {
        continue;
      }
      const absolute = path.join(dir, entry);
      let stats;
      try {
        stats = statSync(absolute);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        visit(absolute);
      } else if (stats.mtimeMs > threshold + 1000) {
        // 1 秒容差：索引写盘与文件落盘的时钟误差
        count += 1;
      }
    }
  };
  visit(repoRoot);
  return count;
}
