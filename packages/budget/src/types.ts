/**
 * 预算域实体（data-model.md §4–§5）。
 *
 * 测量尽力而为：运行时不报告 usage → measured=false（数字 0），
 * 不伪造；卫生规则（负/NaN/非整数）在 Ledger 入口钳制。
 */

export interface UsageInput {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

/** Agent 级执行记录（三级聚合的原子） */
export interface UsageRecord {
  /** RuntimeAdapter 执行 runId */
  runId: string;
  taskId: string;
  role: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  /** 实测执行时长 */
  durationMs: number;
  /** 装配产物 token 估算（口径 = estimateTokens，全链一致） */
  contextSize: number;
  /** 单价表（缺省全 0——只计数不计价）计算的成本 */
  estimatedCost: number;
  /** 运行时未报告 usage = false（数字为 0，不伪造） */
  measured: boolean;
}

export interface UsageSums {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  durationMs: number;
  contextSize: number;
  estimatedCost: number;
  executions: number;
}

/** 优化收益估算（原始材料 vs 实际装配） */
export interface OptimizationStat {
  rawTokens: number;
  packedTokens: number;
  /** savedRatio = 1 - packed/raw（raw=0 时为 0） */
  savedRatio: number;
}

export interface TaskBudgetSummary {
  taskId: string;
  sums: UsageSums;
  /** 该任务每次装配的优化统计（多执行多条） */
  optimizations: OptimizationStat[];
  executions: UsageRecord[];
}

export interface BudgetReport {
  mission: {
    sums: UsageSums;
    optimization: OptimizationStat;
  };
  tasks: TaskBudgetSummary[];
}

/** 单价表（每千 token 计价；缺省全 0 = 只计数） */
export interface PriceTable {
  inputPerMillion: number;
  outputPerMillion: number;
  cachedPerMillion: number;
}

export const DEFAULT_PRICES: PriceTable = {
  inputPerMillion: 0,
  outputPerMillion: 0,
  cachedPerMillion: 0,
};
