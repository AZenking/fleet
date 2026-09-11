import { appendFileSync, existsSync, readFileSync } from 'node:fs';

import { newEventId, serializeEvent, type FleetEvent } from '@fleet/core';

/**
 * EventSink（research.md D1/D7）：事件即时 appendFileSync——进程
 * 任何时刻死亡，已发生的事件已在盘上；读取半行容错（尾行 parse
 * 失败跳过并计数——不崩溃不吞）。
 */

export interface EmittedEvent {
  type: string;
  payload?: Record<string, unknown>;
}

export class EventSink {
  constructor(private readonly eventsPath: string) {}

  emit(event: EmittedEvent): FleetEvent {
    const fleetEvent: FleetEvent = {
      id: newEventId(),
      type: event.type,
      timestamp: new Date().toISOString(),
      payload: event.payload ?? {},
    };
    appendFileSync(this.eventsPath, `${serializeEvent(fleetEvent)}\n`);
    return fleetEvent;
  }
}

export interface ReadEventsResult {
  events: FleetEvent[];
  /** 跳过的损坏行数（半行容错——标注而非吞） */
  skippedLines: number;
}

export function readEvents(eventsPath: string): ReadEventsResult {
  if (!existsSync(eventsPath)) {
    return { events: [], skippedLines: 0 };
  }
  const raw = readFileSync(eventsPath, 'utf8');
  const events: FleetEvent[] = [];
  let skippedLines = 0;
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed === 'object' && parsed !== null && 'id' in parsed) {
        events.push(parsed as FleetEvent);
      } else {
        skippedLines += 1;
      }
    } catch {
      skippedLines += 1;
    }
  }
  return { events, skippedLines };
}
