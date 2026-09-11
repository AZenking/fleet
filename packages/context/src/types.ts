import type { AgentRole, Mission, Task } from '@fleet/mission';

/**
 * 上下文装配域实体（data-model.md §1–§3、§6）。
 *
 * 宪法/roadmap M10 红线：禁止 Full Conversation + Full Repository +
 * All Artifacts 全量塞给所有 Agent——SECTION_KINDS 闭集 + 声明式
 * 角色规则表让"未知 section"不存在构造路径（结构性排除）。
 */

export const SECTION_KINDS = [
  'mission',
  'taskGoal',
  'findings',
  'evidence',
  'source',
  'constraints',
  'diff',
  'validation',
  'feedback',
  'config',
] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

export interface ContextSection {
  kind: SectionKind;
  /** 来源引用（task:<id> / mission / validation:<artId> / feedback…） */
  source: string;
  /** unavailable 时空（不伪造） */
  content: string;
  sizeTokens: number;
  /** 压缩顺序：小者先截（mission/taskGoal 最高保护） */
  priority: number;
  truncated: boolean;
  /** 上游缺失 / 供应方未注入 */
  unavailable: boolean;
}

export interface ContextPackage {
  taskId: string;
  role: AgentRole;
  sections: ContextSection[];
  totalTokens: number;
  budget: { limit: number | null; level: 'task' | 'mission' | null };
  /** 已用压缩轮次（0..2） */
  compressions: number;
  /** 优化收益：原始材料 vs 实际装配（SC-005 载体） */
  optimization: { rawTokens: number; packedTokens: number; savedRatio: number };
}

/** Reject/Escalate 载体（executor → 任务失败 retryable=false） */
export interface BudgetRejection {
  taskId: string;
  limit: number;
  level: 'task' | 'mission';
  rounds: number;
  sections: Array<{
    kind: SectionKind;
    sizeTokens: number;
    truncated: boolean;
  }>;
}

/** suppliers：diff / validation / source / config 的注入面（gate/executor 持有数据） */
export interface ContextSuppliers {
  /** 任务 worktree 相对基线的 diff 摘录 */
  diff?: string;
  /** M9 ValidationArtifact 摘要（文本化） */
  validation?: string;
  /** 相关源码摘录（Repository Intelligence 调查产物） */
  source?: string;
  /** 仓库配置摘录 */
  config?: string;
}

export type BuildInput = {
  task: Task;
  mission: Mission;
  registry: import('./registry.js').RunArtifactRegistry;
  suppliers?: ContextSuppliers;
  /** 修复轮次上下文（M9 feedback 通道 → 附加 section） */
  feedback?: string;
  /** 测试/调用方直设预算（优先于约束解析） */
  budgetOverride?: number;
};

export type BuildResult =
  { ok: true; pkg: ContextPackage } | { ok: false; rejection: BudgetRejection };

/** 角色规则（声明式，单一事实源——data-model §6） */
export interface SectionSpec {
  kind: SectionKind;
  priority: number;
}

export const ROLE_CONTEXT_RULES: Record<AgentRole, SectionSpec[]> = {
  reflex: [
    { kind: 'feedback', priority: 8 },
    { kind: 'mission', priority: 9 },
    { kind: 'taskGoal', priority: 10 },
  ],
  focus: [
    { kind: 'source', priority: 3 },
    { kind: 'findings', priority: 4 },
    { kind: 'feedback', priority: 8 },
    { kind: 'mission', priority: 9 },
    { kind: 'taskGoal', priority: 10 },
  ],
  reason: [
    { kind: 'source', priority: 2 },
    { kind: 'evidence', priority: 3 },
    { kind: 'findings', priority: 4 },
    { kind: 'constraints', priority: 5 },
    { kind: 'feedback', priority: 8 },
    { kind: 'mission', priority: 9 },
    { kind: 'taskGoal', priority: 10 },
  ],
  insight: [
    { kind: 'config', priority: 2 },
    { kind: 'source', priority: 3 },
    { kind: 'diff', priority: 4 },
    { kind: 'validation', priority: 5 },
    { kind: 'feedback', priority: 8 },
    { kind: 'mission', priority: 9 },
    { kind: 'taskGoal', priority: 10 },
  ],
  wisdom: [
    { kind: 'diff', priority: 3 },
    { kind: 'findings', priority: 4 },
    { kind: 'validation', priority: 5 },
    { kind: 'feedback', priority: 8 },
    { kind: 'mission', priority: 9 },
    { kind: 'taskGoal', priority: 10 },
  ],
};

/** run 内上游产物（内存事实源；record 幂等覆盖——重试/修复取末次） */
export interface ArtifactEntry {
  taskId: string;
  role: AgentRole;
  ok: boolean;
  output: string;
}
