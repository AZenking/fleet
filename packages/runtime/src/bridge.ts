import type { Task } from '@fleet/mission';
import type { TaskExecutor } from '@fleet/scheduler';

import { ID_PREFIXES, createId } from '@fleet/core';

import type { RuntimeAdapter } from './types.js';
import {
  DEFAULT_TASK_TIMEOUT_MS,
  REQUEST_PERMISSION_ENV,
  permissionOf,
} from './types.js';

/**
 * MissionRuntimeBridge（research.md D5）：TaskExecutor（M5 端口）到
 * RuntimeAdapter 的唯一转换点——runId / agentId / prompt / timeoutMs
 * 的生成规则集中于此。任务角色经 env 通道传递（RuntimeRequest 契约
 * 无角色字段——env 是 roadmap 契约的扩展点）。
 */

export interface BridgeConfig {
  cwd: string;
  defaultTimeoutMs?: number;
}

interface MissionBudget {
  /** mission 级 maxDurationMs（无则 undefined） */
  missionMaxDurationMs?: number;
}

export interface TaskTiming {
  startedAt: string;
  endedAt: string;
}

export class MissionRuntimeBridge implements TaskExecutor {
  readonly requests: Array<{ runId: string; taskId: string }> = [];
  readonly taskTimings = new Map<string, TaskTiming>();
  readonly perTaskTimeoutMs = new Map<string, number>();

  constructor(
    private readonly runtime: RuntimeAdapter,
    private readonly config: BridgeConfig,
    private readonly budgetConfig: MissionBudget = {},
  ) {}

  async execute(
    task: Task,
    feedback?: string,
  ): Promise<{ ok: boolean; detail?: string }> {
    const runId = createId(ID_PREFIXES.run); // 每次执行唯一（重试 = 新 runId）
    const timeoutMs = this.timeoutFor(task);
    this.requests.push({ runId, taskId: task.id });
    this.perTaskTimeoutMs.set(task.id, timeoutMs);
    const startedAt = new Date().toISOString();
    try {
      const result = await this.runtime.execute({
        runId,
        agentId: `agent:${task.id}`,
        cwd: this.config.cwd,
        prompt: `[任务 ${task.id}] ${task.goal}${
          feedback !== undefined ? `\n[修复反馈] ${feedback}` : ''
        }`,
        env: {
          FLEET_AGENT_ROLE: task.agentRole,
          [REQUEST_PERMISSION_ENV]: permissionOf(task.agentRole),
        },
        timeoutMs,
      });
      return {
        ok: result.ok,
        ...(result.detail !== undefined ? { detail: result.detail } : {}),
      };
    } finally {
      this.taskTimings.set(task.id, {
        startedAt,
        endedAt: new Date().toISOString(),
      });
    }
  }

  /** 推导优先级：task maxDurationMs > mission maxDurationMs > 默认（整段透传） */
  private timeoutFor(task: Task): number {
    const taskLevel = task.constraints?.find(
      (constraint) => constraint.kind === 'maxDurationMs',
    );
    if (taskLevel !== undefined) {
      return taskLevel.value;
    }
    return (
      this.budgetConfig.missionMaxDurationMs ??
      this.config.defaultTimeoutMs ??
      DEFAULT_TASK_TIMEOUT_MS
    );
  }
}
