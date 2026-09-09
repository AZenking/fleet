import { describe, expect, it } from 'vitest';
import { planQuestion } from './planner.js';

describe('planQuestion（确定性解析，FR-011）', () => {
  it('帕斯卡 / 驼峰 / snake / 常量识别为符号（受上限 3 截断）', () => {
    const plan = planQuestion(
      'FleetError loadFleetConfig parse_invoice MAX_RETRIES',
    );
    expect(plan.symbols).toEqual([
      'FleetError',
      'loadFleetConfig',
      'parse_invoice',
    ]);
    expect(plan.keywords).toEqual([]);
  });

  it('符号上限 3 个', () => {
    const plan = planQuestion('Aaa Bbb Ccc Ddd Eee');
    expect(plan.symbols).toHaveLength(3);
  });

  it('路径样式进 pathHints', () => {
    const plan = planQuestion('看下 src/a.ts 和 packages/core 的 loader.ts');
    expect(plan.pathHints).toContain('src/a.ts');
    expect(plan.pathHints).toContain('loader.ts');
  });

  it('中文问题：去停用词后保留关键词', () => {
    const plan = planQuestion('FleetError 在哪里被抛出');
    expect(plan.symbols).toEqual(['FleetError']);
    expect(plan.keywords).toContain('抛出');
    expect(plan.keywords).not.toContain('在哪里');
  });

  it('空问题 → 空计划', () => {
    expect(planQuestion('   ')).toEqual({
      symbols: [],
      keywords: [],
      pathHints: [],
    });
  });
});
