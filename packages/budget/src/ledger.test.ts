import { describe, expect, it } from 'vitest';

import { estimateCost, estimateTokens } from './estimate.js';
import { BudgetLedger, mergeOptimizations, ratioOf } from './ledger.js';
import type { UsageRecord } from './types.js';

/** T002：估算口径 / 三级聚合算术 / 测量卫生矩阵 */

function recordOf(
  taskId: string,
  partial: Partial<UsageRecord> = {},
): UsageRecord {
  return {
    runId: `run_${taskId}`,
    taskId,
    role: 'reason',
    inputTokens: 100,
    outputTokens: 50,
    cachedTokens: 10,
    durationMs: 200,
    contextSize: 300,
    estimatedCost: 0,
    measured: true,
    ...partial,
  };
}

describe('estimateTokens（口径）', () => {
  it('字符系数换算（缺省 4）+ 上取整', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('abcdefgh', 8)).toBe(1);
    expect(() => estimateTokens('x', 0)).toThrow();
  });

  it('单价缺省全 0 → 成本 0；配置单价后按百万 token 计价', () => {
    expect(
      estimateCost({ inputTokens: 1000, outputTokens: 100, cachedTokens: 0 }),
    ).toBe(0);
    expect(
      estimateCost(
        {
          inputTokens: 1_000_000,
          outputTokens: 500_000,
          cachedTokens: 1_000_000,
        },
        { inputPerMillion: 3, outputPerMillion: 6, cachedPerMillion: 0.3 },
      ),
    ).toBe(6.3);
  });
});

describe('BudgetLedger（三级聚合）', () => {
  it('task 级 = 执行之和（含修复轮次双执行）；mission 级 = 任务之和', () => {
    const ledger = new BudgetLedger();
    ledger.record(recordOf('a', { inputTokens: 100 }));
    ledger.record(recordOf('a', { inputTokens: 40, outputTokens: 10 })); // 修复轮次
    ledger.record(recordOf('b', { inputTokens: 7, role: 'focus' }));
    const report = ledger.snapshot();
    const a = report.tasks.find((task) => task.taskId === 'a')!;
    expect(a.sums.inputTokens).toBe(140);
    expect(a.sums.executions).toBe(2);
    expect(a.executions).toHaveLength(2); // 明细保留
    expect(report.mission.sums.inputTokens).toBe(147);
    expect(report.mission.sums.executions).toBe(3);
  });

  it('卫生矩阵：负 / NaN / 非整数 → 钳 0 + measured=false（不伪造）', () => {
    const ledger = new BudgetLedger();
    ledger.record(
      recordOf('dirty', {
        inputTokens: -5,
        outputTokens: Number.NaN,
        cachedTokens: 1.5,
        measured: true,
      }),
    );
    const task = ledger.snapshot().tasks[0]!;
    expect(task.sums.inputTokens).toBe(0);
    expect(task.sums.outputTokens).toBe(0);
    expect(task.sums.cachedTokens).toBe(0);
    expect(task.executions[0]!.measured).toBe(false);
  });

  it('未测量执行：measured=false 数字 0，照常入聚合', () => {
    const ledger = new BudgetLedger();
    ledger.record(
      recordOf('unmeasured', {
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        measured: false,
      }),
    );
    const task = ledger.snapshot().tasks[0]!;
    expect(task.executions[0]!.measured).toBe(false);
    expect(task.sums.durationMs).toBe(200); // 实测字段照记
  });

  it('优化统计：task 归组 + mission 汇总', () => {
    const ledger = new BudgetLedger();
    ledger.record(recordOf('a'));
    ledger.recordOptimization('a', {
      rawTokens: 1000,
      packedTokens: 250,
      savedRatio: 0.75,
    });
    ledger.recordOptimization('a', {
      rawTokens: 100,
      packedTokens: 100,
      savedRatio: 0,
    });
    const report = ledger.snapshot();
    expect(report.tasks[0]!.optimizations).toHaveLength(2);
    expect(report.mission.optimization).toEqual({
      rawTokens: 1100,
      packedTokens: 350,
      savedRatio: 0.682,
    });
  });
});

describe('ratioOf', () => {
  it('raw=0 → 0；正常派生三位小数', () => {
    expect(ratioOf(0, 0)).toBe(0);
    expect(ratioOf(100, 25)).toBe(0.75);
  });

  it('mergeOptimizations 空表 → 全 0', () => {
    expect(mergeOptimizations([])).toEqual({
      rawTokens: 0,
      packedTokens: 0,
      savedRatio: 0,
    });
  });
});
