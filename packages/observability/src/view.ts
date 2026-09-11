import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import type { FleetEvent } from '@fleet/core';

import { readEvents } from './sink.js';
import { CANCEL_MARKER, RUNS_DIR, type RunSummary } from './store.js';

/**
 * RunStatusView（research.md D4）：纯事件流重建（事实记录唯一
 * 真相源）——终态 = 最后 mission.* 终态事件；有 started 无终态 →
  interrupted；无 started → 不列（从未开始，零虚假 interrupted）。
 */

export type RunViewStatus =
  'completed' | 'failed' | 'cancelled' | 'interrupted';

export interface RunStatusView {
  missionId: string;
  runShort: string;
  dir: string;
  status: RunViewStatus;
  startedAt?: string;
  endedAt?: string;
  tasks: Array<{ taskId: string; status: string }>;
  counts: {
    completed: number;
    failed: number;
    skipped: number;
    interrupted: number;
    pending: number;
  };
}

export function listRuns(repoRoot: string): RunStatusView[] {
  const base = path.join(repoRoot, RUNS_DIR);
  if (!existsSync(base)) {
    return [];
  }
  const views: RunStatusView[] = [];
  for (const missionId of readdirSync(base, { withFileTypes: true })) {
    if (!missionId.isDirectory()) {
      continue;
    }
    for (const runShort of readdirSync(path.join(base, missionId.name), {
      withFileTypes: true,
    })) {
      if (!runShort.isDirectory()) {
        continue;
      }
      const dir = path.join(base, missionId.name, runShort.name);
      const view = viewRun(dir);
      if (view !== undefined) {
        views.push(view);
      }
    }
  }
  return views.sort((a, b) =>
    `${a.missionId}/${a.runShort}`.localeCompare(
      `${b.missionId}/${b.runShort}`,
    ),
  );
}

/** 单 run 视图；无 started 事件 → undefined（从未开始，不列） */
export function viewRun(runDir: string): RunStatusView | undefined {
  const missionJson = path.join(runDir, 'mission.json');
  if (!existsSync(missionJson)) {
    return undefined;
  }
  const { mission } = JSON.parse(readFileSync(missionJson, 'utf8')) as {
    mission: { id: string; tasks?: Array<{ id: string }> };
  };
  const { events } = readEvents(path.join(runDir, 'events.jsonl'));

  const started = events.find((event) => event.type === 'mission.started');
  if (started === undefined) {
    return undefined; // 从未开始——不虚假造 interrupted
  }
  const terminal = [...events]
    .reverse()
    .find((event) =>
      ['mission.completed', 'mission.failed', 'mission.cancelled'].includes(
        event.type,
      ),
    );

  const declared = (mission.tasks ?? []).map((task) => task.id);
  const taskStatus = new Map<string, string>();
  for (const id of declared) {
    taskStatus.set(id, 'pending');
  }
  for (const event of events) {
    const taskId = strOf(event.payload?.taskId);
    if (taskId === undefined || !taskStatus.has(taskId)) {
      continue;
    }
    if (event.type === 'task.completed') {
      taskStatus.set(taskId, 'completed');
    } else if (
      event.type === 'task.failed' &&
      taskStatus.get(taskId) !== 'completed'
    ) {
      taskStatus.set(taskId, 'failed');
    } else if (
      event.type === 'task.skipped' &&
      taskStatus.get(taskId) === 'pending'
    ) {
      taskStatus.set(taskId, 'skipped');
    } else if (
      event.type === 'task.started' &&
      taskStatus.get(taskId) === 'pending'
    ) {
      taskStatus.set(taskId, 'interrupted'); // started 未终态 → 中断点
    }
  }
  // completed/failed 终态在 started 之后出现时覆盖 interrupted
  for (const event of events) {
    const taskId = strOf(event.payload?.taskId);
    if (taskId === undefined) {
      continue;
    }
    if (event.type === 'task.completed') {
      taskStatus.set(taskId, 'completed');
    }
  }

  const tasks = [...taskStatus.entries()].map(([taskId, status]) => ({
    taskId,
    status,
  }));
  const counts = {
    completed: countOf(tasks, 'completed'),
    failed: countOf(tasks, 'failed'),
    skipped: countOf(tasks, 'skipped'),
    interrupted: countOf(tasks, 'interrupted'),
    pending: countOf(tasks, 'pending'),
  };
  return {
    missionId: mission.id,
    runShort: path.basename(runDir),
    dir: runDir,
    status:
      terminal !== undefined
        ? (terminal.type.replace('mission.', '') as RunViewStatus)
        : 'interrupted',
    startedAt: strOf(started.payload?.at) ?? started.timestamp,
    endedAt: terminal !== undefined ? terminal.timestamp : undefined,
    tasks,
    counts,
  };
}

export function readSummaryFile(runDir: string): RunSummary | undefined {
  const file = path.join(runDir, 'summary.json');
  if (!existsSync(file)) {
    return undefined;
  }
  return JSON.parse(readFileSync(file, 'utf8')) as RunSummary;
}

/** 该 mission 最新 run 目录（resume 缺省目标） */
export function latestRunDir(
  repoRoot: string,
  missionId: string,
): string | undefined {
  const missionBase = path.join(repoRoot, RUNS_DIR, missionId);
  if (!existsSync(missionBase)) {
    return undefined;
  }
  const dirs = readdirSync(missionBase, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(missionBase, entry.name))
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
  return dirs.at(-1);
}

export function isCancelRequested(runDir: string): boolean {
  return existsSync(path.join(runDir, CANCEL_MARKER));
}

function strOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function countOf(tasks: Array<{ status: string }>, status: string): number {
  return tasks.filter((task) => task.status === status).length;
}

export type { FleetEvent };
