import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * M10 e2e（T013）：三级聚合（SC-003）/ contextSize 与 measured
 * （SC-003）/ 优化收益（SC-005）/ 预算阶梯（SC-004）/ 渲染兼容
 * （SC-007：`[任务 <id>]` 标记）。Fake usage 脚本化注入。
 */

const bin = new URL('../../apps/cli/dist/bin.js', import.meta.url).pathname;
const fixtureClis = new URL('../fixtures/fake-clis/', import.meta.url).pathname;

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'fleet-test',
  GIT_AUTHOR_EMAIL: 'test@fleet.local',
  GIT_COMMITTER_NAME: 'fleet-test',
  GIT_COMMITTER_EMAIL: 'test@fleet.local',
};

let repo: string;

function git(cmd: string): string {
  return execSync(`git ${cmd}`, {
    cwd: repo,
    env: { ...process.env, ...GIT_ENV },
  }).toString();
}

interface RunResult {
  exitCode: number;
  json: Record<string, unknown>;
}

async function runFleet(
  file: string,
  extra: string[] = [],
): Promise<RunResult> {
  const result = await execa(
    process.execPath,
    [
      bin,
      'run',
      file,
      '--runtime',
      'reason=write-cli.sh',
      '--runtime',
      'wisdom=review-approved-cli.sh',
      '--json',
      ...extra,
    ],
    {
      cwd: repo,
      reject: false,
      env: {
        ...process.env,
        ...GIT_ENV,
        PATH: `${fixtureClis}:${process.env.PATH}`,
      },
    },
  );
  return {
    exitCode: result.exitCode ?? -1,
    json: JSON.parse(result.stdout) as Record<string, unknown>,
  };
}

interface BudgetFace {
  mission: {
    sums: { inputTokens: number; outputTokens: number; executions: number };
    optimization: {
      rawTokens: number;
      packedTokens: number;
      savedRatio: number;
    };
  };
  tasks: Array<{
    taskId: string;
    sums: { inputTokens: number; executions: number };
    executions: Array<{
      contextSize: number;
      measured: boolean;
      inputTokens: number;
    }>;
  }>;
}

function budgetOf(run: RunResult): BudgetFace {
  return run.json.budget as BudgetFace;
}

beforeAll(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'fleet-b10-e2e-'));
  git('init -q -b main');
  writeFileSync(path.join(repo, '.gitignore'), '.fleet/\n');
  writeFileSync(path.join(repo, 'base.txt'), 'baseline\n');
  // 双任务 mission：findings 注入（focus 上游）+ reason 写任务
  writeFileSync(
    path.join(repo, 'm1.yaml'),
    `
id: b10-agg
goal: 聚合验证
planningMode: execution
requirements:
  - text: 需求
plan:
  summary: 方案
tasks:
  - id: probe
    goal: 调查上下文
    agentRole: focus
    dependsOn: []
  - id: build
    goal: 实现功能
    agentRole: reason
    dependsOn: [probe]
validation:
  commands:
    tests: echo tests-ok
acceptance:
  - given: 无
    when: 执行
    then: 完成
`,
  );
  // 超预算 mission：maxTokens=1 → Reject/Escalate
  writeFileSync(
    path.join(repo, 'm2.yaml'),
    `
id: b10-reject
goal: 超预算
planningMode: execution
requirements:
  - text: 需求
plan:
  summary: 方案
tasks:
  - id: tiny
    goal: 实现
    agentRole: reason
    dependsOn: []
    constraints:
      - kind: maxTokens
        value: 1
acceptance:
  - given: 无
    when: 执行
    then: 完成
`,
  );
  git('add -A');
  git('commit -qm baseline+missions');
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('M10 e2e：Token 预算与上下文', () => {
  it('三级聚合：focus + reason 双任务 → task/mission sums 正确；优化收益统计', async () => {
    const run = await runFleet('m1.yaml');
    expect(run.exitCode).toBe(0);
    const budget = budgetOf(run);
    expect(budget.tasks).toHaveLength(2);
    const probe = budget.tasks.find((task) => task.taskId === 'probe')!;
    const build = budget.tasks.find((task) => task.taskId === 'build')!;
    expect(probe.sums.executions).toBe(1);
    expect(build.sums.executions).toBeGreaterThanOrEqual(1); // 修复轮次可能追加
    // mission = 任务之和（纯加法）
    expect(budget.mission.sums.executions).toBe(
      probe.sums.executions + build.sums.executions,
    );
    // contextSize > 0（装配尺寸入口径）；Fake 未注入 usage → measured=false
    for (const task of budget.tasks) {
      for (const execution of task.executions) {
        expect(execution.contextSize).toBeGreaterThan(0);
        expect(execution.measured).toBe(false);
        expect(execution.inputTokens).toBe(0);
      }
    }
    // 优化收益：raw ≥ packed，节省比 ∈ [0,1)
    expect(budget.mission.optimization.rawTokens).toBeGreaterThan(0);
    expect(budget.mission.optimization.packedTokens).toBeGreaterThan(0);
    expect(budget.mission.optimization.savedRatio).toBeGreaterThanOrEqual(0);
    expect(budget.mission.optimization.savedRatio).toBeLessThan(1);
  });

  it('渲染兼容（SC-007）：write-cli 照常按 [任务 <id>] 解析写文件 + merged', async () => {
    const run = await runFleet('m1.yaml');
    expect(run.exitCode).toBe(0);
    // write-cli 写 <goal>.txt——依赖 prompt 中的 [任务 X] 标记（M8 语义）
    expect(existsSync(path.join(repo, 'build.txt'))).toBe(true); // write-cli 写 <taskId>.txt（M8 语义）
  });

  it('预算阶梯（SC-004）：maxTokens=1 → Reject/Escalate 终态（不重试、明细完整）', async () => {
    const run = await runFleet('m2.yaml');
    expect(run.exitCode).toBe(1);
    const outcome = run.json.outcome as {
      nodes: Array<{
        taskId: string;
        status: string;
        attempts: number;
        failureReason?: string;
      }>;
    };
    const node = outcome.nodes.find((entry) => entry.taskId === 'tiny')!;
    expect(node.status).toBe('failed');
    expect(node.attempts).toBe(1); // retryable=false 不重试
    expect(node.failureReason).toContain('context 超预算');
    expect(node.failureReason).toContain('mission='); // 逐 section 明细
  });
});
