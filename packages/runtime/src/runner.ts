import { ID_PREFIXES, RealFileSystem, createId } from '@fleet/core';
import type { FileSystemPort } from '@fleet/core';
import {
  validateMissionFile,
  type MissionValidationReport,
  type Run,
  type TaskRun,
} from '@fleet/mission';
import { Scheduler, buildDag, type RunOutcome } from '@fleet/scheduler';
import type { SchedulerConfig, TaskExecutor } from '@fleet/scheduler';
import type { Mission } from '@fleet/mission';

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
  /**
   * M7：执行器工厂（AgentTaskExecutor 注入点）——提供时取代默认
   * bridge+runtime 路径（角色解析 / 权限注入在 @fleet/agents）。
   * 报告合成 duck-typing 读取 requests/taskTimings/perTaskTimeoutMs。
   */
  makeExecutor?: (mission: Mission) => TaskExecutor;
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

/** 执行器可报告面（AgentTaskExecutor / M6 bridge / M8 装饰器共同形态） */
interface ExecutorReportFace {
  taskTimings?: Map<string, { startedAt: string; endedAt: string }>;
  perTaskTimeoutMs?: Map<string, number>;
  requests?: Array<{ role: string; runtime: string; permission: string }>;
  /** M8 WorkspaceResolvingExecutor 的处置记录 */
  dispositions?: Array<{
    taskId: string;
    action: string;
    outcome?: string;
    detail?: string;
  }>;
  /** M9 验证门报告面（ReviewPackage 数组，结构由 @fleet/validation 定义） */
  reviews?: unknown[];
}

export interface RunReport {
  run: Run;
  outcome: RunOutcome;
  runtime: {
    adapter: string;
    perTaskTimeoutMs: Record<string, number>;
    /** role→runtime 名义（AgentTaskExecutor 路径，SC-005 可追溯） */
    runtimes?: Record<string, string>;
  };
  /** M8：worktree 处置记录（taskId / action / outcome / detail） */
  workspaces?: Array<{
    taskId: string;
    action: string;
    outcome?: string;
    detail?: string;
  }>;
  /** M9：ReviewPackage 数组（每 gated 任务一份——结构见 @fleet/validation） */
  reviews?: unknown[];
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
  const executor: TaskExecutor =
    options.makeExecutor !== undefined ? options.makeExecutor(mission) : bridge;
  const outcome = await scheduler.run(dag, executor);
  const endedAt = new Date().toISOString();

  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const reportFace = executor as ExecutorReportFace;
  const timings = reportFace.taskTimings ?? bridge.taskTimings;
  const taskRuns: TaskRun[] = outcome.nodes.map((node) => {
    const task = tasksById.get(node.taskId);
    const timing = timings.get(node.taskId);
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
      adapter: runtimeNamesOf(reportFace),
      perTaskTimeoutMs: Object.fromEntries(
        reportFace.perTaskTimeoutMs ?? bridge.perTaskTimeoutMs,
      ),
      ...(runtimesMapOf(reportFace) !== undefined
        ? { runtimes: runtimesMapOf(reportFace) }
        : {}),
    },
    ...(reportFace.dispositions !== undefined
      ? { workspaces: reportFace.dispositions }
      : {}),
    ...(reportFace.reviews !== undefined
      ? { reviews: reportFace.reviews }
      : {}),
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

function runtimeNamesOf(face: ExecutorReportFace): string {
  const requests = face.requests;
  if (requests === undefined) {
    return 'fake';
  }
  const names = [...new Set(requests.map((request) => request.runtime))];
  return names.length === 1 ? (names[0] ?? 'fake') : 'mixed';
}

function runtimesMapOf(
  face: ExecutorReportFace,
): Record<string, string> | undefined {
  if (face.requests === undefined) {
    return undefined;
  }
  return Object.fromEntries(
    face.requests.map((request) => [request.role, request.runtime]),
  );
}
