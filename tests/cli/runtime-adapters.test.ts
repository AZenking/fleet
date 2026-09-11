import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * M7 集成 e2e（tasks.md T012/T014）：
 * 替身运行时端到端（PATH 注入，确定性）/ SC-001 替换自由度 /
 * SC-005 可追溯 / 不静默降级 / pi 真实运行时（探测启用，缺失跳过）。
 */

const bin = new URL('../../apps/cli/dist/bin.js', import.meta.url).pathname;
const fixtureClis = new URL('../fixtures/fake-clis/', import.meta.url).pathname;
const demo = new URL('../../missions/demo.yaml', import.meta.url).pathname;

let tmp: string;
let hasPi = false;

beforeAll(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'fleet-m7-'));
  try {
    await execa('pi', ['--version'], { reject: false, timeout: 3000 });
    hasPi = true;
  } catch {
    hasPi = false;
  }
});

afterAll(async () => {
  const { rm } = await import('node:fs/promises');
  await rm(tmp, { recursive: true, force: true });
});

async function runFleet(
  args: string[],
  options: { env?: Record<string, string> } = {},
) {
  return execa(process.execPath, [bin, ...args], {
    reject: false,
    env: options.env,
  });
}

const STANDIN_PATH = (dir: string): Record<string, string> => ({
  ...process.env,
  PATH: `${dir}:${process.env.PATH}`,
});

describe('替身运行时端到端（确定性）', () => {
  it('--runtime ok.sh：全角色接替身，prompt 与权限真实到达 CLI', async () => {
    const result = await runFleet(
      ['run', demo, '--runtime', 'ok.sh', '--no-worktree', '--json'],
      { env: STANDIN_PATH(fixtureClis) },
    );
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.run.status).toBe('completed');
    // SC-005 可追溯：有任务的角色全部路由到替身（demo 全 reason）
    expect(report.runtime.runtimes).toEqual({ reason: 'ok.sh' });
    expect(report.runtime.adapter).toBe('ok.sh');
  });

  it('SC-001 替换自由度：fake vs 替身双跑——派发序一致，行为差异仅来自注册', async () => {
    const fakeRun = await runFleet(['run', demo, '--no-worktree', '--json']);
    const standinRun = await runFleet(
      ['run', demo, '--runtime', 'ok.sh', '--no-worktree', '--json'],
      { env: STANDIN_PATH(fixtureClis) },
    );
    expect(fakeRun.exitCode).toBe(0);
    expect(standinRun.exitCode).toBe(0);
    const fake = JSON.parse(fakeRun.stdout);
    const standin = JSON.parse(standinRun.stdout);
    // Scheduler / bridge / mission 零改定的可观测面：调度行为一致
    expect(standin.outcome.dispatchOrder).toEqual(fake.outcome.dispatchOrder);
    expect(standin.outcome.status).toEqual(fake.outcome.status);
    // 差异只来自运行时注册
    expect(fake.runtime.adapter).toBe('fake');
    expect(standin.runtime.adapter).toBe('ok.sh');
  });

  it('单角色覆盖：reason=替身（demo 全 reason 任务 → 全部替身效果）', async () => {
    const result = await runFleet(
      ['run', demo, '--runtime', 'reason=ok.sh', '--no-worktree', '--json'],
      { env: STANDIN_PATH(fixtureClis) },
    );
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.runtime.runtimes).toEqual({ reason: 'ok.sh' });
  });

  it('失败链真实进程版：fail.sh → error 码 + M5 重试传播语义', async () => {
    const mission = path.join(tmp, 'failing.yaml');
    await writeFile(
      mission,
      `
id: m7-fail
goal: 失败链
planningMode: execution
requirements:
  - text: 需求
plan:
  summary: 方案
tasks:
  - id: bad
    goal: 必败
    agentRole: reason
    dependsOn: []
  - id: down
    goal: 下游
    agentRole: insight
    dependsOn: [bad]
acceptance:
  - given: 无
    when: 执行
    then: 完成
`,
      'utf8',
    );
    const proper = await runFleet(
      ['run', mission, '--runtime', 'fail.sh', '--no-worktree', '--json'],
      { env: STANDIN_PATH(fixtureClis) },
    );
    expect(proper.exitCode).toBe(1);
    const report = JSON.parse(proper.stdout);
    const bad = report.outcome.nodes.find(
      (node: { taskId: string }) => node.taskId === 'bad',
    );
    expect(bad.attempts).toBe(2); // retry=1：真实子进程失败重试
    expect(bad.failureReason).toContain('退出码 1');
    const down = report.outcome.nodes.find(
      (node: { taskId: string }) => node.taskId === 'down',
    );
    expect(down.status).toBe('skipped');
  });
});

describe('不静默降级（FR-007 / quickstart E）', () => {
  it('--runtime codex（未装）→ 退出码 1 + 零执行', async () => {
    const result = await runFleet([
      'run',
      demo,
      '--runtime',
      'codex',
      '--json',
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toContain('不静默降级');
    expect(result.stdout).not.toContain('dispatchOrder'); // 未产生任何执行
  });

  it('未知名且 PATH 不可达 → 用法级报错', async () => {
    const result = await runFleet([
      'run',
      demo,
      '--runtime',
      'ghost-cli',
      '--no-worktree',
    ]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('未知运行时');
  });
});

describe('pi 真实运行时（探测启用，缺失跳过）', () => {
  it('reason=pi：请求真实到达 pi 进程（结果接受成败，断言链路形态）', async (context) => {
    if (!hasPi) {
      context.skip();
      return;
    }
    const mission = path.join(tmp, 'pi-mission.yaml');
    await writeFile(
      mission,
      `
id: m7-pi
goal: 真实运行时链路验证
planningMode: execution
requirements:
  - text: 需求
plan:
  summary: 方案
tasks:
  - id: probe-task
    goal: 用一句话回答 1+1 等于几
    agentRole: reason
    dependsOn: []
    constraints:
      - kind: maxDurationMs
        value: 60000
acceptance:
  - given: 无
    when: 执行
    then: 完成
`,
      'utf8',
    );
    const result = await runFleet([
      'run',
      mission,
      '--runtime',
      'reason=pi',
      '--no-worktree',
      '--json',
    ]);
    // 真实 LLM 输出不可断言成败（认证 / 网络 / 模型行为）——
    // 断言链路形态：请求到达 pi、可追溯、退出码与终态自洽
    const report = JSON.parse(result.stdout);
    expect(report.runtime.runtimes).toEqual({ reason: 'pi' });
    expect(report.outcome.dispatchOrder).toContain('probe-task');
    const node = report.outcome.nodes.find(
      (n: { taskId: string }) => n.taskId === 'probe-task',
    );
    if (result.exitCode === 0) {
      expect(node.status).toBe('completed');
    } else {
      expect(node.status).toBe('failed');
      expect(node.failureReason).toBeTruthy();
    }
    expect([0, 1]).toContain(result.exitCode);
  }, 90_000);
});
