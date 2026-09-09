import { describe, expect, it } from 'vitest';
import { ID_PREFIXES, createId, newEventId } from './index.js';

describe('createId', () => {
  it('生成带前缀的 UUID（US3 验收：前缀 + 唯一）', () => {
    const a = createId('evt_');
    const b = createId('evt_');
    expect(a).toMatch(/^evt_[0-9a-f-]{36}$/);
    expect(b).toMatch(/^evt_[0-9a-f-]{36}$/);
    expect(a).not.toBe(b);
  });

  it('newEventId 使用 evt_ 前缀', () => {
    expect(newEventId()).toMatch(/^evt_/);
  });

  it('非法前缀被拒绝', () => {
    expect(() => createId('evt')).toThrowError(RangeError);
    expect(() => createId('EVT_')).toThrowError(RangeError);
  });

  it('预定义前缀均为合法形态', () => {
    for (const prefix of Object.values(ID_PREFIXES)) {
      expect(() => createId(prefix)).not.toThrow();
    }
  });
});
