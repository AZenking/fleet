import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CliRuntimeAdapter } from './cli-adapter.js';
import type { RuntimeRequest } from './types.js';

/**
 * US2：CliRuntimeAdapter 替身矩阵（tasks.md T011 / SC-003 / SC-006）。
 * 受控 PATH 注入 tests/fixtures/fake-clis——真实子进程验证
 * kill / 孤儿 / 截断 / 裸请求拒绝。
 */

const fixtureDir = new URL(
  '../../../tests/fixtures/fake-clis/',
  import.meta.url,
).pathname;

function standIn(script: string): CliRuntimeAdapter {
  return new CliRuntimeAdapter({
    name: `stand-in-${script}`,
    command: `./${script}.sh`,
    buildArgs: (request) => [request.prompt],
    env: {},
  });
}

function request(
  input: Partial<RuntimeRequest> & { cwd?: string },
): RuntimeRequest {
  return {
    runId: `run_t-${Math.random().toString(36).slice(2, 8)}`,
    agentId: 'agent:t1',
    cwd: fixtureDir, // 替身脚本所在目录（./相对调用）
    prompt: '测试 prompt',
    env: { FLEET_AGENT_ROLE: 'reason', FLEET_PERMISSION: 'DEEP_WRITE' },
    timeoutMs: 5000,
    ...input,
  };
}

let tmp: string;

beforeAll(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'fleet-cli-adapter-'));
});

afterAll(async () => {
  const { rm } = await import('node:fs/promises');
  await rm(tmp, { recursive: true, force: true });
});

function pidAlive(pid: number | undefined): boolean {
  if (pid === undefined || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(file: string): number | undefined {
  if (!existsSync(file)) {
    return undefined;
  }
  return Number.parseInt(readFileSync(file, 'utf8').trim(), 10);
}

async function waitFor(
  probe: () => boolean,
  timeoutMs = 3000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (probe()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return probe();
}

describe('成功与输出（M6 条款 1）', () => {
  it('ok.sh：prompt 与权限环境到达 CLI；exit 0 → ok', async () => {
    const adapter = standIn('ok');
    const result = await adapter.execute(request({}));
    expect(result.ok).toBe(true);
    expect(result.output).toContain('ARGS: 测试 prompt');
    expect(result.output).toContain('PERM: DEEP_WRITE');
    expect(result.output).toContain('ROLE: reason');
    expect(adapter.inflightSize).toBe(0);
  });

  it('fail.sh：非零退出 → error 码 + stderr 摘要', async () => {
    const result = await standIn('fail').execute(request({}));
    expect(result.ok).toBe(false);
    expect(result.code).toBe('error');
    expect(result.detail).toContain('退出码 1');
    expect(result.detail).toContain('simulated CLI failure');
  });
});

describe('裸请求拒绝（FR-006，不启子进程）', () => {
  it('无权限声明 → error 且替身零调用', async () => {
    const callLog = path.join(tmp, 'calls.log');
    const adapter = new CliRuntimeAdapter({
      name: 'ok-counted',
      command: './ok.sh',
      buildArgs: (r) => [r.prompt],
      env: { FAKE_CLI_CALL_LOG: callLog },
    });
    const result = await adapter.execute(
      request({ env: { FLEET_AGENT_ROLE: 'reason' } }),
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('缺少权限声明');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(existsSync(callLog)).toBe(false); // 子进程从未启动
  });
});

describe('timeout / cancel：进程组 kill（M6 条款 2/3/4）', () => {
  it('超预算 → timeout + slow.sh 进程被杀（无残留）', async () => {
    const pidFile = path.join(tmp, 'slow1.pid');
    const adapter = new CliRuntimeAdapter({
      name: 'slow',
      command: './slow.sh',
      buildArgs: () => [],
      env: { FAKE_CLI_PIDFILE: pidFile },
    });
    const start = Date.now();
    const result = await adapter.execute(request({ timeoutMs: 100 }));
    expect(result.code).toBe('timeout');
    expect(Date.now() - start).toBeLessThan(1000);
    expect(adapter.inflightSize).toBe(0);
    const pid = readPid(pidFile);
    expect(await waitFor(() => !pidAlive(pid))).toBe(true); // 无孤儿
  }, 5000);

  it('cancel → 毫秒级 cancelled，进程组同灭', async () => {
    const pidFile = path.join(tmp, 'slow2.pid');
    const adapter = new CliRuntimeAdapter({
      name: 'slow',
      command: './slow.sh',
      buildArgs: () => [],
      env: { FAKE_CLI_PIDFILE: pidFile },
    });
    const runId = 'run_cancel_case';
    const promise = adapter.execute(request({ runId, timeoutMs: 8000 }));
    expect(await waitFor(() => readPid(pidFile) !== undefined)).toBe(true);
    const cancelStart = Date.now();
    await adapter.cancel(runId);
    const result = await promise;
    expect(result.code).toBe('cancelled');
    expect(Date.now() - cancelStart).toBeLessThan(200); // 毫秒级
    const pid = readPid(pidFile);
    expect(await waitFor(() => !pidAlive(pid))).toBe(true);
    expect(adapter.inflightSize).toBe(0);
  }, 5000);

  it('spawner：孙进程同灭（进程组语义）', async () => {
    const pidFile = path.join(tmp, 'spawn.pid');
    const adapter = new CliRuntimeAdapter({
      name: 'spawner',
      command: './spawner.sh',
      buildArgs: () => [],
      env: { FAKE_CLI_PIDFILE: pidFile },
    });
    const runId = 'run_spawn_case';
    const promise = adapter.execute(request({ runId, timeoutMs: 8000 }));
    const childFile = `${pidFile}.child`;
    expect(await waitFor(() => readPid(childFile) !== undefined)).toBe(true);
    await adapter.cancel(runId);
    const result = await promise;
    expect(result.code).toBe('cancelled');
    const mainPid = readPid(pidFile);
    const childPid = readPid(childFile);
    expect(await waitFor(() => !pidAlive(mainPid))).toBe(true);
    expect(await waitFor(() => !pidAlive(childPid))).toBe(true); // 孙进程无孤儿
  }, 8000);

  it('cancel 不存在的 runId：无异常', async () => {
    await expect(standIn('ok').cancel('run_nope')).resolves.toBeUndefined();
  });
});

describe('输出截断（FR-004）', () => {
  it('big-output.sh：>64KB 截断 + 标注', async () => {
    const result = await standIn('big-output').execute(
      request({ timeoutMs: 10000 }),
    );
    expect(result.ok).toBe(true);
    expect(result.output?.length).toBeLessThanOrEqual(64 * 1024 + 100);
    expect(result.output).toContain('[输出已截断至 64KB]');
  }, 10000);
});

describe('启动失败（M6 条款 1：异常不逃逸）', () => {
  it('命令不存在 → error 码（不抛异常）', async () => {
    const result = await new CliRuntimeAdapter({
      name: 'ghost',
      command: 'definitely-not-a-command-xyz',
      buildArgs: () => [],
    }).execute(request({}));
    expect(result.ok).toBe(false);
    expect(result.code).toBe('error');
    expect(result.detail).toContain('启动失败');
  });
});
