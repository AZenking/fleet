import { randomUUID } from 'node:crypto';

/**
 * ID 生成：语义前缀 + randomUUID（research.md D6，零新增依赖）。
 * 前缀保证人可读可辨识（evt_ / run_ / task_ / msn_）。
 */

export const ID_PREFIXES = {
  event: 'evt_',
  run: 'run_',
  task: 'task_',
  mission: 'msn_',
} as const;

export type IdPrefix = keyof typeof ID_PREFIXES;

const PREFIX_PATTERN = /^[a-z]+_$/;

export function createId(prefix: string): string {
  if (!PREFIX_PATTERN.test(prefix)) {
    throw new RangeError(`非法 ID 前缀：${prefix}（应为形如 evt_ 的小写前缀）`);
  }
  return `${prefix}${randomUUID()}`;
}

export function newEventId(): string {
  return createId(ID_PREFIXES.event);
}
