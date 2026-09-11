import { ID_PREFIXES, RealFileSystem, createId } from '@fleet/core';
import type { FileSystemPort } from '@fleet/core';
import {
  validateMissionFile,
  type MissionValidationReport,
  type Run,
  type TaskRun,
} from '@fleet/mission';
import { Scheduler, buildDag, type RunOutcome } from '@fleet/scheduler';
import type { SchedulerConfig } from '@fleet/scheduler';

import { MissionRuntimeBridge } from './bridge.js';
import { FakeRuntimeAdapter } from './fake.js';
import type { RuntimeAdapter } from './types.js';

/**
 * mission 执行编排（research.md D1/D6/D7/D8）：
 * M4 校验前置（失败零执行）→ M5 DAG/调度 → 桥接 + Fake →
 * RunReport（M4 Run 实例 + M5 RunOutcome，构造后 runSchema 自校验）。
 * 事件经注入的 emitEvent 回调（CLI 接 stderr；库层可测顺序）。
 */

export interface RunnerOptions {
  fs?: FileSystemPort;
  runtime?: RuntimeAdapter;
  schedulerConfig?: Partial<SchedulerConfig>;
  /** 目标仓库根（RuntimeRequest.cwd） */
  cwd?: string;
  /** 事件出口（缺省丢弃——库层可测，CLI 接 stderr） */
  emitEvent?: (event: MissionRunEvent) => void;
}

export type MissionRunEvent =
  | { type: 'mission.run.started'; runId: string; missionId: string }
  | {
      type: 'mission.run.completed' | 'mission.run.failed';
      runId: string;
      missionId: string;
      taskCount: number;
      failedCount: number;
      durationMs: number;
    };

export interface RunReport {
  run: Run;
  outcome: RunOutcome;
  runtime: {
    adapter: 'fake';
    perTaskTimeoutMs: Record<string, number>;
  };
  note?: string;
}

export type MissionRunOutcome =
  | { kind: 'completed'; report: RunReport }
  | { kind: 'failed'; report: RunReport }
  | { kind: 'invalid'; validation: MissionValidationReport };

export async function runMissionFile(
  missionPath: string,
  options: RunnerOptions = {},
): Promise<MissionRunOutcome> {
  const fs = options.fs ?? new RealFileSystem();
  const { report: validation } = validateMissionFile(missionPath, fs);
  if (!validation.ok || validation.mission === undefined) {
    return { kind: 'invalid', validation };
  }
  const mission = validation.mission;

  const runtime =
    options.runtime ?? new FakeRuntimeAdapter({ zeroDelays: true });
  const missionMaxDurationMs = mission.constraints.find(
    (constraint) => constraint.kind === 'maxDurationMs',
  )?.value;
  const bridge = new MissionRuntimeBridge(
    runtime,
    { cwd: options.cwd ?? process.cwd() },
    { missionMaxDurationMs },
  );
  const emit = options.emitEvent ?? (() => {});
  const startedAt = new Date().toISOString();
  const runId = createId(ID_PREFIXES.run);
  emit({ type: 'mission.run.started', runId, missionId: mission.id });

  const tasks = mission.tasks ?? [];
  if (tasks.length === 0) {
    const report: RunReport = {
      run: {
        id: runId,
        missionId: mission.id,
        status: 'completed',
        startedAt,
        taskRuns: [],
      },
      outcome: {
        status: 'completed',
        nodes: [],
        dispatchOrder: [],
        propagation: [],
        durationMs: 0,
      },
      runtime: { adapter: 'fake', perTaskTimeoutMs: {} },
      note: 'autonomous mission 无任务——Reason 规划属 M7，本次无可执行内容',
    };
    emit({
      type: 'mission.run.completed',
      runId,
      missionId: mission.id,
      taskCount: 0,
      failedCount: 0,
      durationMs: 0,
    });
    return { kind: 'completed', report };
  }

  const dag = buildDag(tasks);
  const scheduler = new Scheduler(options.schedulerConfig);
  const outcome = await scheduler.run(dag, bridge);
  const endedAt = new Date().toISOString();

  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const taskRuns: TaskRun[] = outcome.nodes.map((node) => {
    const task = tasksById.get(node.taskId);
    const timing = bridge.taskTimings.get(node.taskId);
    return {
      taskId: node.taskId,
      status: node.status,
      agentRole: task?.agentRole ?? 'reason',
      ...(timing !== undefined
        ? { startedAt: timing.startedAt, endedAt: timing.endedAt }
        : {}),
    };
  });

  const runStatus = outcome.status;
  const report: RunReport = {
    run: {
      id: runId,
      missionId: mission.id,
      status: runStatus,
      startedAt,
      endedAt,
      taskRuns,
    },
    outcome,
    runtime: {
      adapter: 'fake',
      perTaskTimeoutMs: Object.fromEntries(bridge.perTaskTimeoutMs),
    },
  };
  const failedCount = outcome.nodes.filter(
    (node) => node.status === 'failed',
  ).length;
  emit({
    type:
      runStatus === 'completed'
        ? 'mission.run.completed'
        : 'mission.run.failed',
    runId,
    missionId: mission.id,
    taskCount: tasks.length,
    failedCount,
    durationMs: outcome.durationMs,
  });
  return { kind: runStatus, report };
}
