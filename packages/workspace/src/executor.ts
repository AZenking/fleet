import path from 'node:path';

import type { Task } from '@fleet/mission';
import type { TaskExecutor } from '@fleet/scheduler';
import { ROLE_PERMISSIONS } from '@fleet/runtime';

import { GitWorktreeManager, WorkspaceCreateError } from './manager.js';
import type {
  GateDecision,
  Workspace,
  WorkspaceDisposition,
  WorkspaceGate,
} from './types.js';

/**
 * WorkspaceResolvingExecutor（research.md D5，TaskExecutor 装饰器）：
 * 只读角色（M7 矩阵单一来源）→ inner 直通（cwd=主仓根）；
 * 写授权角色 → create worktree → inner（cwd=worktree）→ [gate] →
 * 按结果处置（auto：成功 merge / 失败 destroy；keep-on-finish：
 * 保留）。create 故障 → 任务失败（detail=fault code），不击穿
 * 调度循环。
 *
 * M9 gate 接缝：inner 成功后经 gate 判定（验证 + 审阅 + 修复
 * 循环），处置按 decision.pass 走；无 gate = M8 行为逐字节不变
 * （逃生口 FR-010）。gate 异常 → fail-closed 任务失败 + destroy。
 */

export type WorkspacePolicy = 'auto' | 'keep-on-finish';

export interface WorkspaceExecutorConfig {
  inner: TaskExecutor;
  manager: GitWorktreeManager;
  repoRoot: string;
  policy?: WorkspacePolicy;
  runId?: string;
  /** M9 验证门（缺省 = M8 auto 处置） */
  gate?: WorkspaceGate;
}

/** 任务执行结果（scheduler 终态信号扩展：缺省可重试） */
type ExecutionResult = { ok: boolean; detail?: string; retryable?: boolean };

export class WorkspaceResolvingExecutor implements TaskExecutor {
  /** 处置记录面（runner duck-typing 读取进 RunReport.workspaces） */
  readonly dispositions: WorkspaceDisposition[] = [];
  private readonly workspaceCwd = new Map<string, string>();

  constructor(private readonly config: WorkspaceExecutorConfig) {}

  /** gate 报告面（runner duck-typing 读取进 RunReport.reviews） */
  get reviews(): unknown[] | undefined {
    return this.config.gate?.packages;
  }

  /** cwd 查表面（供 AgentTaskExecutor 的 per-task resolver 绑定） */
  cwdResolver(task: Task): string {
    return this.workspaceCwd.get(task.id) ?? this.config.repoRoot;
  }

  /** 供 inner executor 构造时绑定：cwd: (task) => this.cwdResolver(task) */

  async execute(task: Task): Promise<ExecutionResult> {
    if (ROLE_PERMISSIONS[task.agentRole] === 'READ_ONLY') {
      // 只读角色：物理范围最小化——主仓根直通
      return this.config.inner.execute(task);
    }

    let workspace: Workspace;
    try {
      workspace = await this.config.manager.create(task.id, {
        runId: this.config.runId,
      });
    } catch (error) {
      const fault =
        error instanceof WorkspaceCreateError
          ? error.fault
          : { code: 'git_failed' as const, detail: String(error) };
      return {
        ok: false,
        detail: `工作区创建失败（${fault.code}）：${fault.detail}`,
      };
    }
    this.workspaceCwd.set(task.id, workspace.path);

    let result: ExecutionResult;
    try {
      result = await this.config.inner.execute(task);
    } catch (error) {
      result = {
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    const decision = await this.evaluateGate(task, workspace, result);
    if (decision !== undefined) {
      result = gateResult(decision, result);
    }
    const gateOutcome = decision?.outcome;

    if (this.config.policy === 'keep-on-finish') {
      this.dispositions.push({
        taskId: task.id,
        action: 'kept',
        ...(gateOutcome !== undefined ? { outcome: gateOutcome } : {}),
        detail: `worktree ${path.basename(workspace.path)}（keep-on-finish）`,
      });
      return result;
    }

    if (result.ok) {
      const merge = await this.config.manager.merge(workspace);
      this.dispositions.push({
        taskId: task.id,
        action: merge.kind === 'conflict' ? 'conflict' : 'merged',
        outcome: gateOutcome !== undefined ? gateOutcome : merge.kind,
        ...(merge.kind === 'conflict'
          ? { detail: `冲突文件：${merge.files.join('、')}` }
          : {}),
      });
      // FR-006 处置完整：merged 后清理 worktree（分支随 destroy 删除）；
      // conflict 保留现场供人工处置
      if (merge.kind !== 'conflict') {
        await this.config.manager.destroy(workspace);
      }
      return result;
    }

    const destroy = await this.config.manager.destroy(workspace);
    this.dispositions.push({
      taskId: task.id,
      action: 'destroyed',
      outcome: destroy.ok ? (gateOutcome ?? 'ok') : 'cleanup_partial',
      ...(destroy.ok ? {} : { detail: `残留：${destroy.residual.join('；')}` }),
    });
    return result;
  }

  /** gate 判定（无 gate = undefined → M8 路径）；异常 fail-closed 为拒绝决策 */
  private async evaluateGate(
    task: Task,
    workspace: Workspace,
    execution: ExecutionResult,
  ): Promise<GateDecision | undefined> {
    const gate = this.config.gate;
    if (gate === undefined) {
      return undefined;
    }
    try {
      return await gate.evaluate({
        task,
        workspace,
        execution,
        reexecute: (feedback: string) =>
          this.config.inner.execute(task, feedback),
      });
    } catch (error) {
      return {
        pass: false,
        outcome: 'review_error',
        detail: `gate 异常（fail-closed）：${error instanceof Error ? error.message : String(error)}`,
        retryable: false,
      };
    }
  }
}

/** gate 决策 → 任务结果：判定独立于实现者自报（宪法 III——detail 只取 gate 侧） */
function gateResult(
  decision: GateDecision,
  execution: ExecutionResult,
): ExecutionResult {
  return {
    ok: decision.pass,
    ...(decision.detail !== undefined
      ? { detail: decision.detail }
      : execution.detail !== undefined
        ? { detail: execution.detail }
        : {}),
    ...(decision.retryable !== undefined
      ? { retryable: decision.retryable }
      : {}),
  };
}
