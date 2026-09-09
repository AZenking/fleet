import { describe, expect, it } from 'vitest';
import { newEventId } from '../ids/index.js';
import {
  deserializeEvent,
  fleetEventSchema,
  serializeEvent,
  type FleetEvent,
} from './index.js';

function makeEvent(overrides: Partial<FleetEvent> = {}): FleetEvent {
  return fleetEventSchema.parse({
    id: newEventId(),
    type: 'doctor.completed',
    timestamp: new Date().toISOString(),
    payload: { ready: true },
    ...overrides,
  });
}

describe('FleetEvent', () => {
  it('合法事件通过 schema（US3 验收）', () => {
    expect(() => makeEvent()).not.toThrow();
  });

  it('序列化往返无损（JSON 可序列化）', () => {
    const event = makeEvent({ payload: { ready: false, count: 2 } });
    const round = deserializeEvent(serializeEvent(event));
    expect(round).toEqual(event);
  });

  it('非 evt_ 前缀的 id 被拒绝', () => {
    expect(() => makeEvent({ id: 'run_not-an-event' })).toThrowError();
  });

  it('非点分 type 被拒绝', () => {
    expect(() => makeEvent({ type: 'invalidtype' })).toThrowError();
  });

  it('非 ISO 时间戳被拒绝', () => {
    expect(() => makeEvent({ timestamp: 'yesterday' })).toThrowError();
  });
});
