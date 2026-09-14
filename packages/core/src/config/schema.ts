import { z } from 'zod';

/**
 * FleetConfiguration — configs/fleet.yaml 的 Schema（data-model.md §1）。
 * strict：未知字段拒绝，保证配置面收敛。
 */

const defaultsSchema = z.strictObject({
  maxConcurrency: z.number().int().min(1).max(64).default(3),
  retry: z.number().int().min(0).max(10).default(1),
  /** 占位字段组：M0 只存储不解释（budget 语义在后续里程碑定义） */
  budget: z.record(z.string(), z.unknown()).optional(),
});

export const CODEGRAPH_MAINTAIN_POLICIES = ['manual', 'sync', 'auto'] as const;
export type CodegraphMaintainPolicy =
  (typeof CODEGRAPH_MAINTAIN_POLICIES)[number];

const codegraphSchema = z.strictObject({
  /** 索引自动维护策略（specs/014）：manual=只建议（缺省）；
   * sync=stale 自动 codegraph sync；auto=额外 uninitialized 时 init */
  autoMaintain: z.enum(CODEGRAPH_MAINTAIN_POLICIES).default('manual'),
  /** 维护子进程超时上限（ms） */
  timeoutMs: z.number().int().positive().default(300_000),
});

export const fleetConfigSchema = z.strictObject({
  /** 配置格式版本；M0 仅接受 1 */
  version: z.literal(1),
  /** 目标仓库路径；缺省 = 仓库根 */
  repository: z.string().optional(),
  defaults: defaultsSchema.default({ maxConcurrency: 3, retry: 1 }),
  codegraph: codegraphSchema.optional(),
});

export type FleetConfiguration = z.infer<typeof fleetConfigSchema>;
