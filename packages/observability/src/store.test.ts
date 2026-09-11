import { appendFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMission, type Mission } from '@fleet/mission';

import { EventSink, readEvents } from './sink.js';
import { RunStore, fingerprintOf } from './store.js';

/** T002/T003：流式 sink / 半行容错 / 目录布局 / 指纹敏感性 */

let repo: string;

beforeAll(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'fleet-obs-'));
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

const MISSION = `
id: obs-demo
goal: 可观测
planningMode: execution
requirements:
  - text: 需求
plan:
  summary: 方案
tasks:
  - id: a
    goal: A
    agentRole: reason
    dependsOn: []
  - id: b
    goal: B
    agentRole: focus
    dependsOn: [a]
acceptance:
  - given: 无
    when: 执行
    then: 完成
`;

function missionOf(yaml = MISSION): Mission {
  return loadMission(yaml, { sourcePath: '<test>' });
}

describe('EventSink（流式 + 半行容错）', () => {
  it('emit 即落盘（读回一致）；FleetEvent 字段自动', () => {
    const dir = mkdtempSync(path.join(repo, 'sink-'));
    const eventsPath = path.join(dir, 'events.jsonl');
    const sink = new EventSink(eventsPath);
    sink.emit({ type: 'task.started', payload: { taskId: 'a' } });
    const { events, skippedLines } = readEvents(eventsPath);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'task.started',
      payload: { taskId: 'a' },
    });
    expect(events[0]!.id).toMatch(/^evt_/);
    expect(events[0]!.timestamp).toMatch(/^\d{4}-/);
    expect(skippedLines).toBe(0);
  });

  it('尾部半行（kill -9 模拟）→ 跳过并计数，零崩溃', () => {
    const dir = mkdtempSync(path.join(repo, 'sink-half-'));
    const eventsPath = path.join(dir, 'events.jsonl');
    const sink = new EventSink(eventsPath);
    sink.emit({ type: 'mission.started' });
    // 手工追加半行（模拟 append 中断）
    appendFileSync(eventsPath, '{"id":"evt_broken","type":"task.st');
    const { events, skippedLines } = readEvents(eventsPath);
    expect(events).toHaveLength(1);
    expect(skippedLines).toBe(1);
  });

  it('空/缺失文件 → 空结果', () => {
    expect(readEvents(path.join(repo, 'missing.jsonl'))).toEqual({
      events: [],
      skippedLines: 0,
    });
  });
});

describe('RunStore（目录生命周期 + 指纹）', () => {
  it('beginRun 布局幂等 + finalize 四面', () => {
    const store = new RunStore(repo);
    const mission = missionOf();
    const first = store.beginRun(mission, 'run_aaaa0001');
    const second = store.beginRun(mission, 'run_aaaa0001'); // 幂等
    expect(first.dir).toBe(second.dir);
    for (const file of ['mission.json', 'events.jsonl', 'artifacts', 'logs']) {
      expect(existsSync(path.join(first.dir, file))).toBe(true);
    }
    store.finalize(first.dir, {
      summary: {
        status: 'completed',
        startedAt: 't0',
        endedAt: 't1',
        tasks: [{ taskId: 'a', status: 'completed', attempts: 1 }],
        cumulativeAttempts: { a: 1 },
      },
      usage: { mission: { sums: { executions: 1 } } },
      diffs: [{ taskId: 'a', patch: 'diff --git a/x b/x' }],
      validation: [{ taskId: 'a', terminal: 'approved' }],
    });
    expect(store.readSummary(first.dir)?.status).toBe('completed');
    expect(existsSync(path.join(first.dir, 'usage.json'))).toBe(true);
    expect(existsSync(path.join(first.dir, 'diff.patch'))).toBe(true);
    expect(existsSync(path.join(first.dir, 'validation.json'))).toBe(true);
  });

  it('cancel 标记通道', () => {
    const store = new RunStore(repo);
    const mission = missionOf();
    const { dir } = store.beginRun(mission, 'run_aaaa0002');
    expect(store.isCancelRequested(dir)).toBe(false);
    store.requestCancel(dir);
    expect(store.isCancelRequested(dir)).toBe(true);
  });

  it('指纹：任务集变更敏感、任务排序无关字段不敏感', () => {
    const base = fingerprintOf(missionOf());
    // 任务集不变 + goal 变更 → 同指纹（任务集级校验）
    const goalChanged = fingerprintOf(
      missionOf(MISSION.replace('goal: 可观测', 'goal: 变了')),
    );
    expect(goalChanged).toBe(base);
    // 任务 id 变更 → 漂移
    const taskChanged = fingerprintOf(
      missionOf(MISSION.replace('- id: b', '- id: b2')),
    );
    expect(taskChanged).not.toBe(base);
    // 依赖变更 → 漂移
    const depsChanged = fingerprintOf(
      missionOf(MISSION.replace('dependsOn: [a]', 'dependsOn: []')),
    );
    expect(depsChanged).not.toBe(base);
  });
});
