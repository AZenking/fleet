import type { AgentRole } from '@fleet/mission';

import type { ArtifactEntry } from './types.js';

/**
 * RunArtifactRegistry（research.md D2）：任务执行产物按 taskId
 * 收集（幂等覆盖——重试/修复轮次取最后一次）；ContextBuilder 按
 * DAG 依赖解析直接上游。跨进程持久化属 M11（.fleet/runs/）。
 */
export class RunArtifactRegistry {
  private readonly entries = new Map<string, ArtifactEntry>();

  record(entry: ArtifactEntry): void {
    this.entries.set(entry.taskId, entry);
  }

  outputsOf(taskId: string): ArtifactEntry | undefined {
    return this.entries.get(taskId);
  }

  /** 全部 focus 角色产物（findings 来源） */
  findings(): ArtifactEntry[] {
    return this.byRole('focus');
  }

  /** 全部 insight 角色产物（evidence 来源） */
  evidences(): ArtifactEntry[] {
    return this.byRole('insight');
  }

  private byRole(role: AgentRole): ArtifactEntry[] {
    return [...this.entries.values()].filter((entry) => entry.role === role);
  }
}
