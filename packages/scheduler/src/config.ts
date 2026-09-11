import { z } from 'zod';

/**
 * SchedulerConfig（research.md D7）：与 core fleet.yaml 的 defaults
 * 语义对齐（M6+ 接线透传），但 schema 独立在 scheduler 包——
 * core 不感知 scheduler。构造即校验（FR-005/006 边界拒绝）。
 *
 * M11：shouldStop 为运行时回调（非序列化配置——strictObject
 * 显式放行该函数字段）。
 */

export const schedulerConfigSchema = z.strictObject({
  maxConcurrency: z.number().int().min(1).max(64).default(3),
  retry: z.number().int().min(0).max(10).default(1),
});

/** M11：shouldStop 为运行时回调（函数字段不经 schema——手工透传） */
export interface SchedulerConfig extends z.infer<typeof schedulerConfigSchema> {
  /** cancel 检查点（批次屏障间轮询——缺省永不停止） */
  shouldStop?: () => boolean;
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  maxConcurrency: 3,
  retry: 1,
};

export function resolveSchedulerConfig(
  partial?: Partial<SchedulerConfig>,
): SchedulerConfig {
  const { shouldStop, ...rest } = partial ?? {};
  const parsed = schedulerConfigSchema.parse(rest);
  return shouldStop !== undefined ? { ...parsed, shouldStop } : parsed;
}
