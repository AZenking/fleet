import {
  DEFAULT_PRICES,
  type BudgetReport,
  type OptimizationStat,
  type PriceTable,
  type TaskBudgetSummary,
  type UsageRecord,
  type UsageSums,
} from './types.js';

/**
 * BudgetLedger（research.md D9）：执行级记录 → taskId 聚合 →
 * mission 聚合（三级视图一次 snapshot）。卫生规则：负数 / NaN /
 * 非整数在入口钳制为 0 并标 measured=false（测量卫生，不伪造）。
 * 修复轮次的多次执行同 taskId 累计（executions 明细保留）。
 */

export class BudgetLedger {
  private readonly records = new Map<string, UsageRecord[]>();
  private readonly optimizations = new Map<string, OptimizationStat[]>();
  private readonly prices: PriceTable;

  constructor(prices: PriceTable = DEFAULT_PRICES) {
    this.prices = prices;
  }

  record(record: UsageRecord): void {
    const sanitized = sanitize(record);
    const list = this.records.get(record.taskId) ?? [];
    list.push(sanitized);
    this.records.set(record.taskId, list);
  }

  /** 每次装配的优化统计（与执行记录并列，按 taskId 归组） */
  recordOptimization(taskId: string, stat: OptimizationStat): void {
    const list = this.optimizations.get(taskId) ?? [];
    list.push(stat);
    this.optimizations.set(taskId, list);
  }

  snapshot(): BudgetReport {
    const tasks: TaskBudgetSummary[] = [...this.records.entries()].map(
      ([taskId, executions]) => ({
        taskId,
        sums: sumOf(executions),
        optimizations: this.optimizations.get(taskId) ?? [],
        executions,
      }),
    );
    const all = tasks.flatMap((task) => task.executions);
    const allOptimizations = tasks.flatMap((task) => task.optimizations);
    return {
      mission: {
        sums: sumOf(all),
        optimization: mergeOptimizations(allOptimizations),
      },
      tasks,
    };
  }
}

function sanitize(record: UsageRecord): UsageRecord {
  const clean = (value: number): number =>
    Number.isInteger(value) && value >= 0 ? value : 0;
  const tokensValid =
    Number.isInteger(record.inputTokens) &&
    record.inputTokens >= 0 &&
    Number.isInteger(record.outputTokens) &&
    record.outputTokens >= 0 &&
    Number.isInteger(record.cachedTokens) &&
    record.cachedTokens >= 0;
  return {
    ...record,
    inputTokens: clean(record.inputTokens),
    outputTokens: clean(record.outputTokens),
    cachedTokens: clean(record.cachedTokens),
    durationMs: clean(record.durationMs),
    contextSize: clean(record.contextSize),
    estimatedCost: clean(record.estimatedCost),
    measured: record.measured && tokensValid,
  };
}

function sumOf(records: UsageRecord[]): UsageSums {
  const zero: UsageSums = {
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    durationMs: 0,
    contextSize: 0,
    estimatedCost: 0,
    executions: records.length,
  };
  return records.reduce(
    (sums, record) => ({
      inputTokens: sums.inputTokens + record.inputTokens,
      outputTokens: sums.outputTokens + record.outputTokens,
      cachedTokens: sums.cachedTokens + record.cachedTokens,
      durationMs: sums.durationMs + record.durationMs,
      contextSize: sums.contextSize + record.contextSize,
      estimatedCost: sums.estimatedCost + record.estimatedCost,
      executions: sums.executions,
    }),
    zero,
  );
}

export function mergeOptimizations(
  stats: OptimizationStat[],
): OptimizationStat {
  const rawTokens = stats.reduce((sum, stat) => sum + stat.rawTokens, 0);
  const packedTokens = stats.reduce((sum, stat) => sum + stat.packedTokens, 0);
  return {
    rawTokens,
    packedTokens,
    savedRatio: ratioOf(rawTokens, packedTokens),
  };
}

export function ratioOf(rawTokens: number, packedTokens: number): number {
  if (rawTokens <= 0) {
    return 0;
  }
  return Math.round((1 - packedTokens / rawTokens) * 1000) / 1000;
}
