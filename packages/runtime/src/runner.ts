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
  /**
   * M11 resume：完成集（调度输入裁剪——已完成任务零重跑，
   * 以 task.skipped(resume) 事件标注）；缺省全新 run。
   */
  resume?: { completedTaskIds: string[] };
  /**
   * M11 Run 持久化接缝（CLI 注入 @fleet/observability 适配；
   * 缺省不落盘——库层零回归）。begin 在首个事件前调用。
   */
  runPersistence?: RunPersistence;
}

export interface RunPersistence {
  /** run 开局：建目录（返回 dir）；在首个事件发射前调用 */
  begin(mission: Mission, runId: string): string;
  /** cancel 标记检查（scheduler shouldStop） */
  isCancelRequested(dir: string): boolean;
  /** 终局四面落盘（summary/usage/diff/validation） */
  finalize(dir: string, report: RunReport): void;
}

/** M11 事件全集（roadmap 命名；mission.run.* 为 M6 兼容别名并行发射） */
export type MissionRunEvent =
  | { type: 'mission.created'; runId: string; missionId: string }
  | { type: 'mission.started'; runId: string; missionId: string }
  | { type: 'mission.run.started'; runId: string; missionId: string }
  | {
      type:
        | 'mission.completed'
        | 'mission.failed'
        | 'mission.cancelled'
        | 'mission.run.completed'
        | 'mission.run.failed'
        | 'mission.run.cancelled';
      runId: string;
      missionId: string;
      taskCount: number;
      failedCount: number;
      durationMs: number;
    }
  | { type: 'task.queued'; runId: string; taskId: string }
  | { type: 'task.started'; runId: string; taskId: string }
  | {
      type: 'task.completed' | 'task.failed';
      runId: string;
      taskId: string;
      detail?: string;
    }
  | {
      type: 'task.skipped';
      runId: string;
      taskId: string;
      by: string;
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
    /** M11：merge 前完整变更面（diff.patch 落盘原料） */
    patch?: string;
  }>;
  /** M9 验证门报告面（ReviewPackage 数组，结构由 @fleet/validation 定义） */
  reviews?: unknown[];
  /** M10 预算聚合面（BudgetLedger.snapshot，结构由 @fleet/budget 定义） */
  budget?: unknown;
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
    patch?: string;
  }>;
  /** M9：ReviewPackage 数组（每 gated 任务一份——结构见 @fleet/validation） */
  reviews?: unknown[];
  /** M10：三级聚合 + 优化收益（结构见 @fleet/budget） */
  budget?: unknown;
  note?: string;
}

export type MissionRunOutcome =
  | { kind: 'completed'; report: RunReport }
  | { kind: 'failed'; report: RunReport }
  | { kind: 'cancelled'; report: RunReport }
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
  const runDir = options.runPersistence?.begin(mission, runId);
  emit({ type: 'mission.created', runId, missionId: mission.id });
  emit({ type: 'mission.started', runId, missionId: mission.id });
  emit({ type: 'mission.run.started', runId, missionId: mission.id });

  const allTasks = mission.tasks ?? [];
  // M11 resume：完成集裁剪——已完成任务零重跑（task.skipped 标注）
  const completedSet = new Set(options.resume?.completedTaskIds ?? []);
  for (const task of allTasks) {
    if (completedSet.has(task.id)) {
      emit({ type: 'task.skipped', runId, taskId: task.id, by: 'resume' });
    } else {
      emit({ type: 'task.queued', runId, taskId: task.id });
    }
  }
  const tasks = allTasks
    .filter((task) => !completedSet.has(task.id))
    .map((task) => ({
      ...task,
      // 已完成依赖视为满足——从 DAG 输入中剔除（防悬空依赖）
      dependsOn: task.dependsOn.filter((dep) => !completedSet.has(dep)),
    }));
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
      type: 'mission.completed',
      runId,
      missionId: mission.id,
      taskCount: 0,
      failedCount: 0,
      durationMs: 0,
    });
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
  // M11：cancel 标记 → shouldStop（批次屏障检查点）
  const schedulerConfig =
    runDir !== undefined && options.runPersistence !== undefined
      ? {
          ...options.schedulerConfig,
          shouldStop: () => options.runPersistence!.isCancelRequested(runDir),
        }
      : options.schedulerConfig;
  const scheduler = new Scheduler(schedulerConfig);
  const base: TaskExecutor =
    options.makeExecutor !== undefined ? options.makeExecutor(mission) : bridge;
  // M11：任务生命周期事件包装（不改 TaskExecutor 契约）
  const executor: TaskExecutor = {
    execute: async (task, feedback) => {
      emit({ type: 'task.started', runId, taskId: task.id });
      const result = await base.execute(task, feedback);
      emit(
        result.ok
          ? { type: 'task.completed', runId, taskId: task.id }
          : {
              type: 'task.failed',
              runId,
              taskId: task.id,
              ...(result.detail !== undefined ? { detail: result.detail } : {}),
            },
      );
      return result;
    },
    ...(base.cancelAll !== undefined
      ? { cancelAll: () => base.cancelAll!() }
      : {}),
  };
  const outcome = await scheduler.run(dag, executor);
  const endedAt = new Date().toISOString();
  // 失败传播 / cancel 清扫的 skipped → 事件
  for (const node of outcome.nodes) {
    if (node.status === 'skipped') {
      emit({
        type: 'task.skipped',
        runId,
        taskId: node.taskId,
        by: node.skippedBy ?? 'propagation',
      });
    }
  }

  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  // duck-typing 面读原始执行器（包装器不透传字段）
  const reportFace = base as ExecutorReportFace;
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
    ...(reportFace.budget !== undefined ? { budget: reportFace.budget } : {}),
  };
  const failedCount = outcome.nodes.filter(
    (node) => node.status === 'failed',
  ).length;
  const terminalType =
    runStatus === 'completed'
      ? 'mission.completed'
      : runStatus === 'cancelled'
        ? 'mission.cancelled'
        : 'mission.failed';
  const legacyType =
    runStatus === 'completed'
      ? 'mission.run.completed'
      : runStatus === 'cancelled'
        ? 'mission.run.cancelled'
        : 'mission.run.failed';
  emit({
    type: terminalType,
    runId,
    missionId: mission.id,
    taskCount: tasks.length,
    failedCount,
    durationMs: outcome.durationMs,
  });
  emit({
    type: legacyType,
    runId,
    missionId: mission.id,
    taskCount: tasks.length,
    failedCount,
    durationMs: outcome.durationMs,
  });
  if (runDir !== undefined && options.runPersistence !== undefined) {
    options.runPersistence.finalize(runDir, report);
  }
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
