import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// e2e 走 dist 相对导入（tests/ 不在 workspace 包解析面内，与 bin 同风格）
import { runSchema } from '../../packages/mission/dist/index.js';

/**
 * fleet run 进程级 e2e（M6）：
 * demo 端到端（SC-001/006）+ 进程干净退出（SC-005 用户可见面）+
 * 必败/并发矩阵贯通（T009）+ autonomous + 非法前置拒绝。
 */

const bin = new URL('../../apps/cli/dist/bin.js', import.meta.url).pathname;
const demo = new URL('../../missions/demo.yaml', import.meta.url).pathname;

let tmp: string;

beforeAll(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'fleet-run-'));
});

afterAll(async () => {
  const { rm } = await import('node:fs/promises');
  await rm(tmp, { recursive: true, force: true });
});

async function runFleet(args: string[]) {
  return execa(process.execPath, [bin, ...args], { reject: false });
}

async function writeMission(name: string, yaml: string): Promise<string> {
  const file = path.join(tmp, name);
  await writeFile(file, yaml, 'utf8');
  return file;
}

describe('US1：fleet run 端到端（SC-001 / SC-006）', () => {
  it('demo.yaml：completed + 依赖序 + 事件 + 报告过 runSchema + 进程干净退出', async () => {
    const result = await runFleet(['run', demo, '--json']);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.run.status).toBe('completed');
    expect(report.outcome.dispatchOrder).toEqual(['define-schema', 'wire-cli']);
    // SC-006：报告过 M4 schema
    expect(() => runSchema.parse(report.run)).not.toThrow();
    expect(report.run.id).toMatch(/^run_/);
    // 事件顺序（stderr）：started 先、completed 后，stdout 纯 JSON
    expect(result.stderr).toContain('mission.run.started');
    expect(result.stderr).toContain('mission.run.completed');
    expect(result.stderr.indexOf('mission.run.started')).toBeLessThan(
      result.stderr.indexOf('mission.run.completed'),
    );
  });

  it('文本模式：任务表 + 终态行', async () => {
    const result = await runFleet(['run', demo]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('define-schema');
    expect(result.stdout).toContain('wire-cli');
    expect(result.stdout).toContain('✓ mission completed');
  });

  it('双跑：runId 不同、结果一致', async () => {
    const first = await runFleet(['run', demo, '--json']);
    const second = await runFleet(['run', demo, '--json']);
    const a = JSON.parse(first.stdout);
    const b = JSON.parse(second.stdout);
    expect(a.run.id).not.toBe(b.run.id);
    expect(a.outcome).toEqual(b.outcome);
    expect(a.run.taskRuns.map((r: { status: string }) => r.status)).toEqual(
      b.run.taskRuns.map((r: { status: string }) => r.status),
    );
  });
});

describe('US2 矩阵贯通（T009）', () => {
  it('必败任务：退出码 1 + attempts=2 + 下游 skipped + 传播链', async () => {
    const file = await writeMission(
      'failing.yaml',
      `
id: failing-demo
goal: 失败演示
planningMode: execution
requirements:
  - text: 需求
plan:
  summary: 方案
tasks:
  - id: bad
    goal: 必败（timeout 预算撞画像延迟）
    agentRole: reason
    dependsOn: []
    constraints:
      - kind: maxDurationMs
        value: 5
  - id: down
    goal: 下游
    agentRole: insight
    dependsOn: [bad]
acceptance:
  - given: 无
    when: 执行
    then: 完成
`,
    );
    const result = await runFleet(['run', file, '--json']);
    expect(result.exitCode).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.run.status).toBe('failed');
    const bad = report.outcome.nodes.find(
      (node: { taskId: string }) => node.taskId === 'bad',
    );
    expect(bad.attempts).toBe(2);
    expect(bad.failureReason).toContain('预算'); // timeout 路径
    const down = report.outcome.nodes.find(
      (node: { taskId: string }) => node.taskId === 'down',
    );
    expect(down.status).toBe('skipped');
    expect(report.outcome.propagation).toEqual([
      { failedTaskId: 'bad', skipped: ['down'] },
    ]);
    expect(result.stderr).toContain('mission.run.failed');
  });

  it('3 无依赖任务：真实并发（CLI 角色画像下总耗时远低于串行和）', async () => {
    const file = await writeMission(
      'parallel.yaml',
      `
id: parallel-demo
goal: 并发演示
planningMode: execution
requirements:
  - text: 需求
plan:
  summary: 方案
tasks:
  - id: p1
    goal: 一
    agentRole: reason
    dependsOn: []
  - id: p2
    goal: 二
    agentRole: reason
    dependsOn: []
  - id: p3
    goal: 三
    agentRole: reason
    dependsOn: []
acceptance:
  - given: 无
    when: 执行
    then: 完成
`,
    );
    const result = await runFleet(['run', file, '--json']);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    // reason 画像 45ms × 3：并发应 ≈ 45ms 量级，串行 ≥ 135ms
    expect(report.outcome.durationMs).toBeLessThan(120);
    expect(report.outcome.dispatchOrder).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('US1 场景 4/5：autonomous 与前置拒绝', () => {
  it('autonomous 无任务：退出码 0 + note', async () => {
    const file = await writeMission(
      'auto.yaml',
      `
id: auto-run
goal: 探索
planningMode: autonomous
requirements:
  - text: 调研
acceptance:
  - given: 无
    when: 调研
    then: 结论
`,
    );
    const result = await runFleet(['run', file, '--json']);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.note).toContain('Reason 规划属 M7');
  });

  it('非法 mission：运行前拒绝（校验错误输出 + 退出码 1）', async () => {
    const file = await writeMission(
      'invalid.yaml',
      `
id: invalid-run
goal: 非法
planningMode: execution
requirements:
  - text: 需求
tasks:
  - id: solo
    goal: 干活
    agentRole: coder
    dependsOn: []
acceptance:
  - given: 无
    when: 执行
    then: 完成
`,
    );
    const result = await runFleet(['run', file]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('未执行任何任务');
    expect(result.stdout).toContain('tasks.0.agentRole');
  });
});
