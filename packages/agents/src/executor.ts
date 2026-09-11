import { ID_PREFIXES, createId } from '@fleet/core';
import type { Task } from '@fleet/mission';
import type { TaskExecutor } from '@fleet/scheduler';
import type { RuntimeRequest } from '@fleet/runtime';
import { DEFAULT_TASK_TIMEOUT_MS } from '@fleet/runtime';

import { getAgentDefinition } from './definitions.js';
import {
  REQUEST_PERMISSION_ENV,
  REQUEST_ROLE_ENV,
  permissionOf,
} from './policy.js';
import type { RuntimeRegistry } from './registry.js';

/**
 * AgentTaskExecutor（research.md D2）：M6 bridge 的角色化进化——
 * per-task 解析角色定义（提示 + 权限必经 policy）与注册表运行时，
 * 构造请求并记录（requests 含 runtime 名义与 permission，
 * SC-005 可追溯载体；taskTimings / perTaskTimeoutMs 供报告合成）。
 */

export interface AgentExecutorConfig {
  registry: RuntimeRegistry;
  cwd: string;
  missionMaxDurationMs?: number;
  defaultTimeoutMs?: number;
}

export interface RecordedRequest {
  runId: string;
  taskId: string;
  role: string;
  permission: string;
  runtime: string;
}

export class AgentTaskExecutor implements TaskExecutor {
  readonly requests: RecordedRequest[] = [];
  readonly taskTimings = new Map<
    string,
    { startedAt: string; endedAt: string }
  >();
  readonly perTaskTimeoutMs = new Map<string, number>();

  constructor(private readonly config: AgentExecutorConfig) {}

  async execute(task: Task): Promise<{ ok: boolean; detail?: string }> {
    const definition = getAgentDefinition(task.agentRole);
    const permission = permissionOf(task.agentRole); // 必经 Tool Policy
    const runtime = this.config.registry.resolve(task.agentRole);
    const runId = createId(ID_PREFIXES.run);
    const timeoutMs = this.timeoutFor(task);
    const request: RuntimeRequest = {
      runId,
      agentId: `agent:${task.id}`,
      cwd: this.config.cwd,
      prompt: `[${definition.role} · ${permission}] ${definition.systemPromptSegment}\n[任务 ${task.id}] ${task.goal}`,
      env: {
        [REQUEST_ROLE_ENV]: task.agentRole,
        [REQUEST_PERMISSION_ENV]: permission,
      },
      timeoutMs,
    };
    this.requests.push({
      runId,
      taskId: task.id,
      role: task.agentRole,
      permission,
      runtime: this.config.registry.nameOf(task.agentRole),
    });
    this.perTaskTimeoutMs.set(task.id, timeoutMs);
    const startedAt = new Date().toISOString();
    try {
      const result = await runtime.execute(request);
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

  /** 三档透传（同 M6 bridge）：task maxDurationMs > mission 级 > 默认 */
  private timeoutFor(task: Task): number {
    const taskLevel = task.constraints?.find(
      (constraint) => constraint.kind === 'maxDurationMs',
    );
    if (taskLevel !== undefined) {
      return taskLevel.value;
    }
    return (
      this.config.missionMaxDurationMs ??
      this.config.defaultTimeoutMs ??
      DEFAULT_TASK_TIMEOUT_MS
    );
  }
}
