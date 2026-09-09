import { z } from 'zod';

/**
 * FleetEvent — 结构化事件（data-model.md §3）。
 * M0 仅定义 schema 与 JSON 序列化；持久化是 M11 的范围。
 */

// 注意：source 拼接不能复用带 ^ $ 锚点的 RegExp，此处用纯模式串
const UUID_PATTERN =
  '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export const fleetEventSchema = z.strictObject({
  /** evt_ 前缀 + UUID（ids 模块生成） */
  id: z.string().regex(new RegExp(`^evt_${UUID_PATTERN}$`)),
  /** 点分命名，如 doctor.completed（M0 使用 doctor.* 命名空间） */
  type: z.string().regex(/^[a-z0-9]+(\.[a-z0-9-]+)+$/),
  /** ISO 8601 */
  timestamp: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
  payload: z.record(z.string(), z.unknown()),
});

export type FleetEvent = z.infer<typeof fleetEventSchema>;

export function serializeEvent(event: FleetEvent): string {
  return JSON.stringify(fleetEventSchema.parse(event));
}

export function deserializeEvent(raw: string): FleetEvent {
  return fleetEventSchema.parse(JSON.parse(raw));
}
