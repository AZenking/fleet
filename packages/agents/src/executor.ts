import { ID_PREFIXES, createId } from '@fleet/core';
import type { Mission, Task } from '@fleet/mission';
import type { TaskExecutor } from '@fleet/scheduler';
import type { RuntimeRequest } from '@fleet/runtime';
import { DEFAULT_TASK_TIMEOUT_MS } from '@fleet/runtime';
import type { BudgetLedger, OptimizationStat } from '@fleet/budget';
import { estimateCost } from '@fleet/budget';
import {
  render,
  type ContextBuilder,
  type RunArtifactRegistry,
} from '@fleet/context';

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
 *
 * M10：注入 context 三件套（builder/registry/ledger）时——prompt =
 * 角色头 + ContextBuilder 确定性渲染（`[任务 <id>]` 标记兼容替身
 * CLI）；执行后产物入 registry、usage 入 ledger（三级聚合面）。
 * 缺省回退 M7 手写模板（向后兼容层）。
 */

export interface AgentExecutorConfig {
  registry: RuntimeRegistry;
  /** 主仓根；或 per-task 解析（M8 worktree 集成：写角色查表得 worktree 路径） */
  cwd: string | ((task: Task) => string);
  missionMaxDurationMs?: number;
  defaultTimeoutMs?: number;
  /** M10：上下文装配 + 产物回收（注入时启用新路径） */
  context?: {
    builder: ContextBuilder;
    registry: RunArtifactRegistry;
    ledger: BudgetLedger;
    mission: Mission;
    /** M11 事件出口（budget.warning/exceeded——缺省丢弃） */
    onEvent?: (event: {
      type: string;
      payload?: Record<string, unknown>;
    }) => void;
  };
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
  /** M11：在行执行（runId → 适配器）——cancelAll 的取消面 */
  private readonly inflight = new Map<
    string,
    import('@fleet/runtime').RuntimeAdapter
  >();

  constructor(private readonly config: AgentExecutorConfig) {}

  /** M10：预算聚合面（runner duck-typing 合成 RunReport.budget） */
  get budget(): unknown | undefined {
    return this.config.context?.ledger.snapshot();
  }

  async execute(
    task: Task,
    feedback?: string,
  ): Promise<{ ok: boolean; detail?: string; retryable?: boolean }> {
    const definition = getAgentDefinition(task.agentRole);
    const permission = permissionOf(task.agentRole); // 必经 Tool Policy
    const runtime = this.config.registry.resolve(task.agentRole);
    const runId = createId(ID_PREFIXES.run);
    const timeoutMs = this.timeoutFor(task);

    let prompt: string;
    let contextSize = 0;
    let optimization: OptimizationStat | undefined;
    if (this.config.context !== undefined) {
      const built = this.config.context.builder.build({
        task,
        mission: this.config.context.mission,
        registry: this.config.context.registry,
        feedback,
      });
      if (!built.ok) {
        this.config.context.onEvent?.({
          type: 'budget.exceeded',
          payload: {
            taskId: task.id,
            limit: built.rejection.limit,
            level: built.rejection.level,
          },
        });
        return {
          ok: false,
          retryable: false,
          detail: `context 超预算（Reject/Escalate，${built.rejection.level} 级 limit=${built.rejection.limit}，压缩 ${built.rejection.rounds} 轮后仍超）：${built.rejection.sections
            .map((section) => `${section.kind}=${section.sizeTokens}`)
            .join(' ')}`,
        };
      }
      prompt = `[${definition.role} · ${permission}] ${definition.systemPromptSegment}\n${render(built.pkg)}`;
      contextSize = built.pkg.totalTokens;
      optimization = built.pkg.optimization;
      if (built.pkg.compressions > 0) {
        this.config.context.onEvent?.({
          type: 'budget.warning',
          payload: {
            taskId: task.id,
            compressions: built.pkg.compressions,
            totalTokens: built.pkg.totalTokens,
          },
        });
      }
    } else {
      prompt = `[${definition.role} · ${permission}] ${definition.systemPromptSegment}\n[任务 ${task.id}] ${task.goal}${
        feedback !== undefined ? `\n[修复反馈] ${feedback}` : ''
      }`;
    }

    const request: RuntimeRequest = {
      runId,
      agentId: `agent:${task.id}`,
      cwd:
        typeof this.config.cwd === 'function'
          ? this.config.cwd(task)
          : this.config.cwd,
      prompt,
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
    const started = Date.now();
    this.inflight.set(runId, runtime);
    try {
      const result = await runtime.execute(request);
      this.collect(task, result, runId, started, contextSize, optimization);
      return {
        ok: result.ok,
        ...(result.detail !== undefined ? { detail: result.detail } : {}),
      };
    } catch (error) {
      this.collect(
        task,
        { ok: false },
        runId,
        started,
        contextSize,
        optimization,
      );
      throw error;
    } finally {
      this.inflight.delete(runId);
      this.taskTimings.set(task.id, {
        startedAt,
        endedAt: new Date().toISOString(),
      });
    }
  }

  /** 产物回收：registry（上游注入面）+ ledger（usage 三级聚合面） */
  private collect(
    task: Task,
    result: {
      ok: boolean;
      output?: string;
      detail?: string;
      usage?: {
        inputTokens: number;
        outputTokens: number;
        cachedTokens: number;
      };
    },
    runId: string,
    started: number,
    contextSize: number,
    optimization?: OptimizationStat,
  ): void {
    const context = this.config.context;
    if (context === undefined) {
      return;
    }
    context.registry.record({
      taskId: task.id,
      role: task.agentRole,
      ok: result.ok,
      output: result.output ?? result.detail ?? '',
    });
    const measured = result.usage !== undefined;
    const usage = result.usage ?? {
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
    };
    context.ledger.record({
      runId,
      taskId: task.id,
      role: task.agentRole,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedTokens: usage.cachedTokens,
      durationMs: Date.now() - started,
      contextSize,
      estimatedCost: measured ? estimateCost(usage) : 0,
      measured,
    });
    if (optimization !== undefined) {
      context.ledger.recordOptimization(task.id, optimization);
    }
  }

  /** M11：取消全部在行执行（runtime cancel 通道——宪法 IV） */
  async cancelAll(): Promise<void> {
    for (const [runId, adapter] of [...this.inflight]) {
      await adapter.cancel(runId);
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
