import { existsSync } from 'node:fs';
import path from 'node:path';

import { loadMission, type Mission, type Task } from '@fleet/mission';
import type { FileSystemPort } from '@fleet/core';

import { readEvents } from './sink.js';
import { fingerprintOf } from './store.js';

/**
 * ResumePlan（research.md D5）：完成集 = 事件流 task.completed；
 * 指纹（mission.json）vs 当次 mission 重算——漂移拒绝（防"旧进度
 * 跑新任务集"）；任务级原子（无半任务续传）。
 */

export type ResumePlan =
  | {
      ok: true;
      completedTaskIds: string[];
      pendingTasks: Task[];
      sourceRunDir: string;
    }
  | { ok: false; reason: string };

export function planResume(
  missionPath: string,
  runDir: string,
  fs: FileSystemPort,
): ResumePlan {
  const snapshotFile = path.join(runDir, 'mission.json');
  if (!existsSync(snapshotFile)) {
    return { ok: false, reason: `run 目录无 mission.json：${runDir}` };
  }
  const snapshot = JSON.parse(fs.readFile(snapshotFile)) as {
    mission: Mission;
    fingerprint: string;
  };
  const current = loadMission(fs.readFile(missionPath), {
    sourcePath: missionPath,
  });
  const currentFingerprint = fingerprintOf(current);
  if (currentFingerprint !== snapshot.fingerprint) {
    return {
      ok: false,
      reason: `mission 指纹漂移（盘上 ${snapshot.fingerprint} ≠ 当前 ${currentFingerprint}）——任务集已变更，请全新 run`,
    };
  }

  const { events } = readEvents(path.join(runDir, 'events.jsonl'));
  const completedTaskIds = [
    ...new Set(
      events
        .filter((event) => event.type === 'task.completed')
        .map((event) =>
          typeof event.payload?.taskId === 'string'
            ? event.payload.taskId
            : undefined,
        )
        .filter((taskId): taskId is string => taskId !== undefined),
    ),
  ];
  const pendingTasks = (current.tasks ?? []).filter(
    (task) => !completedTaskIds.includes(task.id),
  );
  if (pendingTasks.length === 0) {
    return { ok: false, reason: '任务已全部完成——无可续跑内容' };
  }
  return { ok: true, completedTaskIds, pendingTasks, sourceRunDir: runDir };
}
