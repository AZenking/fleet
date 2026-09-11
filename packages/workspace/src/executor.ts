import path from 'node:path';

import type { Task } from '@fleet/mission';
import type { TaskExecutor } from '@fleet/scheduler';
import { ROLE_PERMISSIONS } from '@fleet/runtime';

import { GitWorktreeManager, WorkspaceCreateError } from './manager.js';
import type { Workspace, WorkspaceDisposition } from './types.js';

/**
 * WorkspaceResolvingExecutor（research.md D5，TaskExecutor 装饰器）：
 * 只读角色（M7 矩阵单一来源）→ inner 直通（cwd=主仓根）；
 * 写授权角色 → create worktree → inner（cwd=worktree）→ 按结果
 * 处置（auto：成功 merge / 失败 destroy；keep-on-finish：保留）。
 * create 故障 → 任务失败（detail=fault code），不击穿调度循环。
 */

export type WorkspacePolicy = 'auto' | 'keep-on-finish';

export interface WorkspaceExecutorConfig {
  inner: TaskExecutor;
  manager: GitWorktreeManager;
  repoRoot: string;
  policy?: WorkspacePolicy;
  runId?: string;
}

export class WorkspaceResolvingExecutor implements TaskExecutor {
  /** 处置记录面（runner duck-typing 读取进 RunReport.workspaces） */
  readonly dispositions: WorkspaceDisposition[] = [];
  private readonly workspaceCwd = new Map<string, string>();

  constructor(private readonly config: WorkspaceExecutorConfig) {}

  /** cwd 查表面（供 AgentTaskExecutor 的 per-task resolver 绑定） */
  cwdResolver(task: Task): string {
    return this.workspaceCwd.get(task.id) ?? this.config.repoRoot;
  }

  /** 供 inner executor 构造时绑定：cwd: (task) => this.cwdResolver(task) */

  async execute(task: Task): Promise<{ ok: boolean; detail?: string }> {
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

    let result: { ok: boolean; detail?: string };
    try {
      result = await this.config.inner.execute(task);
    } catch (error) {
      result = {
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    if (this.config.policy === 'keep-on-finish') {
      this.dispositions.push({
        taskId: task.id,
        action: 'kept',
        detail: `worktree ${path.basename(workspace.path)}（keep-on-finish）`,
      });
      return result;
    }

    if (result.ok) {
      const merge = await this.config.manager.merge(workspace);
      this.dispositions.push({
        taskId: task.id,
        action: merge.kind === 'conflict' ? 'conflict' : 'merged',
        outcome: merge.kind,
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
      outcome: destroy.ok ? 'ok' : 'cleanup_partial',
      ...(destroy.ok ? {} : { detail: `残留：${destroy.residual.join('；')}` }),
    });
    return result;
  }
}
