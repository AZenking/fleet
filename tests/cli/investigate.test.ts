import { appendFile, readFile, rm, writeFile } from 'node:fs/promises';

import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * fleet repo investigate 进程级 e2e（quickstart 故障注入矩阵）。
 * codegraph 缺失的机器上，健康类场景自动跳过——行为覆盖由假后端
 * 单测矩阵承担（investigate.test.ts）。
 */

const bin = new URL('../../apps/cli/dist/bin.js', import.meta.url).pathname;
const repoRoot = new URL('../../', import.meta.url).pathname;
const fixture = new URL('../../tests/fixtures/sample-repo/', import.meta.url)
  .pathname;

let hasCodegraph = false;
let fixtureIndexed = false;

async function runFleet(
  args: string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
) {
  // 绝对 node 路径：PATH 受控场景下依然可执行
  return execa(process.execPath, [bin, ...args], {
    cwd: options.cwd ?? repoRoot,
    env: options.env,
    reject: false,
  });
}

beforeAll(async () => {
  try {
    await execa('codegraph', ['--version'], { reject: false });
    hasCodegraph = true;
  } catch {
    hasCodegraph = false;
  }
  if (hasCodegraph) {
    // 夹具准备（与 git init 同等地位的测试前置，非 Fleet 运行时行为）
    await execa('codegraph', ['init'], { cwd: fixture });
    fixtureIndexed = true;
  }
});

afterAll(async () => {
  if (fixtureIndexed) {
    await rm(`${fixture}.codegraph`, { recursive: true, force: true });
  }
});

describe('fleet repo investigate（健康路径，US1 / SC-001 / SC-004 / T026 性能）', () => {
  it('夹具仓库：PaymentService 返回锚定引用，走 codegraph 路径（verify）', async (context) => {
    if (!fixtureIndexed) {
      context.skip();
    }
    const result = await runFleet([
      'repo',
      'investigate',
      'PaymentService',
      '--repo',
      fixture,
      '--mode',
      'verify',
      '--json',
    ]);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.pathsUsed).toContain('codegraph');
    expect(
      report.references.some(
        (reference) => reference.filePath === 'src/payment.ts',
      ),
    ).toBe(true);
    expect(report.references.every((reference) => reference.verified)).toBe(
      true,
    );
    // SC-001：健康路径 ≤ 10 秒（防性能回归，T026）
    expect(report.durationMs).toBeLessThanOrEqual(10_000);
    // 事件走 stderr，stdout 保持纯 JSON
    expect(result.stderr).toContain('repo.investigate.completed');
  });

  it('文本模式：包含问题与引用行', async (context) => {
    if (!fixtureIndexed) {
      context.skip();
    }
    const result = await runFleet([
      'repo',
      'investigate',
      'PaymentService',
      '--repo',
      fixture,
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('问题：');
    expect(result.stdout).toContain('src/payment.ts');
  });
});

describe('fleet repo investigate（夹具符号矩阵）', () => {
  it('同名符号 Logger → ambiguous，两处候选都在结果里', async (context) => {
    if (!fixtureIndexed) {
      context.skip();
    }
    const result = await runFleet([
      'repo',
      'investigate',
      'Logger',
      '--repo',
      fixture,
      '--json',
    ]);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.fallbacks.map((reason) => reason.code)).toContain(
      'ambiguous',
    );
    const filePaths = report.references.map((reference) => reference.filePath);
    expect(filePaths).toContain('src/logging.ts');
    expect(filePaths).toContain('src/notify.ts');
  });

  it('高风险（配置驱动）→ 即使命中也记 high_risk（FR-007）', async (context) => {
    if (!fixtureIndexed) {
      context.skip();
    }
    const result = await runFleet([
      'repo',
      'investigate',
      'getRate 配置驱动',
      '--repo',
      fixture,
      '--json',
    ]);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.fallbacks.map((reason) => reason.code)).toContain(
      'high_risk',
    );
    expect(
      report.references.some(
        (reference) => reference.filePath === 'src/config-driven.ts',
      ),
    ).toBe(true);
  });

  it('不存在的符号 → 退出码仍为 0，明确未找到', async () => {
    const result = await runFleet([
      'repo',
      'investigate',
      'NoSuchSymbolXyz',
      '--repo',
      fixture,
      '--json',
    ]);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    const fallbackCodes = report.fallbacks.map((reason) => reason.code);
    expect(
      fallbackCodes.includes('missing_symbol') ||
        report.references.length === 0,
    ).toBe(true);
  });
});

describe('fleet repo investigate（故障注入 e2e）', () => {
  it('受控 PATH：codegraph 与 rg 均不可用 → walk 兜底仍返回结果（宪法 I）', async () => {
    // 最小 PATH：node 已用绝对路径调用，codegraph（fnm 目录）与
    // rg（homebrew 目录）都不在其中
    const result = await runFleet(
      // verify：本仓库可能已有 wiki（fast 会直接用 wiki 免搜索），
      // walk 兜底是 verify 全链的属性
      [
        'repo',
        'investigate',
        'FleetError',
        '--repo',
        repoRoot,
        '--mode',
        'verify',
        '--json',
      ],
      { env: { ...process.env, PATH: '/usr/bin:/bin' } },
    );
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    const fallbackCodes = report.fallbacks.map((reason) => reason.code);
    expect(fallbackCodes).toContain('unavailable');
    expect(report.searchEngine).toBe('walk');
    expect(
      report.references.some((reference) =>
        reference.filePath.includes('packages/core/src/errors'),
      ),
    ).toBe(true);
  });

  it('stale：修改文件不 sync → 降级但仍有结果（场景 #3）', async (context) => {
    if (!fixtureIndexed) {
      context.skip();
    }
    const target = `${fixture}src/payment.ts`;
    const original = await readFile(target, 'utf8');
    try {
      await appendFile(target, '\n// drift marker for stale test\n');
      const result = await runFleet([
        'repo',
        'investigate',
        'PaymentService',
        '--repo',
        fixture,
        '--json',
      ]);
      expect(result.exitCode).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.fallbacks.map((reason) => reason.code)).toContain('stale');
      expect(report.references.length).toBeGreaterThan(0);
    } finally {
      await writeFile(target, original, 'utf8');
    }
  });
});
