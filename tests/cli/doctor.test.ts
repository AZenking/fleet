import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * fleet doctor 进程级 e2e（contracts/cli.md / quickstart 故障注入）。
 * 注入 #1/#2（版本、git 探测）由 core 单元测试覆盖，此处覆盖
 * #3 非 git 目录、#4 配置缺失、#5 字段非法及健康路径与 --json。
 */

const bin = new URL('../../apps/cli/dist/bin.js', import.meta.url).pathname;
const repoRoot = new URL('../../', import.meta.url).pathname;

const fixtures: string[] = [];

afterAll(async () => {
  await Promise.all(
    fixtures.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function runFleet(args: string[], cwd: string) {
  return execa('node', [bin, ...args], { cwd, reject: false });
}

async function makeFixture(withConfig: string | undefined): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'fleet-doctor-'));
  fixtures.push(dir);
  await execa('git', ['init'], { cwd: dir });
  if (withConfig !== undefined) {
    await mkdir(path.join(dir, 'configs'), { recursive: true });
    await writeFile(
      path.join(dir, 'configs', 'fleet.yaml'),
      withConfig,
      'utf8',
    );
  }
  return dir;
}

describe('fleet doctor（健康路径）', () => {
  it('仓库根运行：退出码 0，六项检查，环境就绪', async () => {
    const result = await runFleet(['doctor'], repoRoot);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('环境就绪');
    expect(result.stdout).toContain('✓ node-version');
    expect(result.stdout).toContain('✓ git-repo');
    expect(result.stdout).toContain('✓ fleet-config');
  });

  it('--json：输出可解析且与 DiagnosticReport 一致，退出码与文本模式相同', async () => {
    const result = await runFleet(['doctor', '--json'], repoRoot);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout) as {
      ready: boolean;
      summary: string;
      checks: Array<{ id: string; status: string }>;
      durationMs: number;
    };
    expect(report.ready).toBe(true);
    expect(report.checks).toHaveLength(6);
    expect(report.checks[0]?.id).toBe('node-version');
    expect(report.checks.map((c) => c.id)).toEqual([
      'node-version',
      'git-available',
      'git-repo',
      'fleet-config',
      'codegraph',
      'agent-runtimes',
    ]);
    expect(Number.isInteger(report.durationMs)).toBe(true);
    // SC-002 / T031：健康环境诊断耗时 ≤ 5 秒（防性能回归）
    expect(report.durationMs).toBeLessThanOrEqual(5000);
    // T027：doctor.completed 事件走 stderr，stdout 保持纯 JSON
    expect(result.stderr).toContain('doctor.completed');
    expect(result.stderr).toMatch(/evt_[0-9a-f-]{36}/);
  });
});

describe('fleet doctor（故障注入）', () => {
  it('#3 非 git 目录：git-repo error，退出码 1', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'fleet-nogit-'));
    fixtures.push(dir);
    const result = await runFleet(['doctor', '--json'], dir);
    expect(result.exitCode).toBe(1);
    const report = JSON.parse(result.stdout) as {
      ready: boolean;
      checks: Array<{ id: string; status: string }>;
    };
    expect(report.ready).toBe(false);
    expect(report.checks.find((c) => c.id === 'git-repo')?.status).toBe(
      'error',
    );
  });

  it('#4 配置缺失：fleet-config error 且不因 warning 项失败', async () => {
    const dir = await makeFixture(undefined);
    const result = await runFleet(['doctor', '--json'], dir);
    expect(result.exitCode).toBe(1);
    const report = JSON.parse(result.stdout) as {
      ready: boolean;
      checks: Array<{ id: string; status: string; detail: string }>;
    };
    expect(report.checks.find((c) => c.id === 'fleet-config')?.status).toBe(
      'error',
    );
    expect(
      report.checks.find((c) => c.id === 'fleet-config')?.detail,
    ).toContain('缺失');
  });

  it('#5 字段非法：逐字段定位 version 问题', async () => {
    const dir = await makeFixture('version: 2\n');
    const result = await runFleet(['doctor', '--json'], dir);
    expect(result.exitCode).toBe(1);
    const report = JSON.parse(result.stdout) as {
      checks: Array<{ id: string; status: string; detail: string }>;
    };
    const configCheck = report.checks.find((c) => c.id === 'fleet-config');
    expect(configCheck?.status).toBe('error');
    expect(configCheck?.detail).toContain('version');
  });

  it('加速器缺失（codegraph/runtime warning）不影响 ready 判定', async () => {
    const result = await runFleet(['doctor', '--json'], repoRoot);
    const report = JSON.parse(result.stdout) as {
      ready: boolean;
      checks: Array<{ id: string; status: string }>;
    };
    const acceleratorStatuses = report.checks
      .filter((c) => c.id === 'codegraph' || c.id === 'agent-runtimes')
      .map((c) => c.status);
    // 无论加速器是否安装（ok 或 warning），ready 都必须为 true
    expect(
      acceleratorStatuses.every((s) => s === 'ok' || s === 'warning'),
    ).toBe(true);
    expect(report.ready).toBe(true);
  });
});
