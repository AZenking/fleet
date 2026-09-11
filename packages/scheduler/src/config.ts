import { z } from 'zod';

/**
 * SchedulerConfig（research.md D7）：与 core fleet.yaml 的 defaults
 * 语义对齐（M6+ 接线透传），但 schema 独立在 scheduler 包——
 * core 不感知 scheduler。构造即校验（FR-005/006 边界拒绝）。
 */

export const schedulerConfigSchema = z.strictObject({
  maxConcurrency: z.number().int().min(1).max(64).default(3),
  retry: z.number().int().min(0).max(10).default(1),
});
export type SchedulerConfig = z.infer<typeof schedulerConfigSchema>;

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  maxConcurrency: 3,
  retry: 1,
};

export function resolveSchedulerConfig(
  partial?: Partial<SchedulerConfig>,
): SchedulerConfig {
  return schedulerConfigSchema.parse(partial ?? {});
}
