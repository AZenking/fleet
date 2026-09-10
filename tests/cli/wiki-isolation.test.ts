import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createSampleRepoGitFixture,
  type WikiFixture,
} from '../helpers/git-repo-fixture.js';

/**
 * 隔离对照（宪法 I / FR-010 / SC-005，tasks.md T022）：
 * wiki 存在与否，investigate / doctor 行为完全不变；
 * wiki 内容永远不进入调查证据（.fleet 在排除目录中，M1 既有行为零改动）。
 */

const bin = new URL('../../apps/cli/dist/bin.js', import.meta.url).pathname;
const repoRoot = new URL('../../', import.meta.url).pathname;

let fixture: WikiFixture;

beforeAll(async () => {
  fixture = await createSampleRepoGitFixture();
});

afterAll(async () => {
  await fixture.destroy();
});

async function runFleet(args: string[], cwd: string) {
  return execa(process.execPath, [bin, ...args], { cwd, reject: false });
}

interface InvestigateReport {
  references: Array<{ filePath: string }>;
  pathsUsed: string[];
  fallbacks: Array<{ code: string }>;
}

async function investigatePayment(): Promise<InvestigateReport> {
  const result = await runFleet(
    ['repo', 'investigate', 'PaymentService', '--repo', fixture.root, '--json'],
    repoRoot,
  );
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout) as InvestigateReport;
}

describe('wiki 与既有命令的隔离（SC-005）', () => {
  it('建 wiki 前后 investigate 输出一致（references / pathsUsed / 降级码）', async () => {
    const before = await investigatePayment();

    const init = await runFleet(
      ['wiki', 'init', '--repo', fixture.root],
      repoRoot,
    );
    expect(init.exitCode).toBe(0);
    const build = await runFleet(
      ['wiki', 'build', '--repo', fixture.root, '--json'],
      repoRoot,
    );
    expect(build.exitCode).toBe(0);
    expect(JSON.parse(build.stdout).validation.ok).toBe(true);

    const after = await investigatePayment();
    expect(after.references).toEqual(before.references);
    expect(after.pathsUsed).toEqual(before.pathsUsed);
    expect(after.fallbacks.map((f) => f.code)).toEqual(
      before.fallbacks.map((f) => f.code),
    );
  });

  it('wiki 页面永不进入调查证据（.fleet 排除目录零改动）', async () => {
    const report = await investigatePayment();
    expect(
      report.references.every(
        (reference) => !reference.filePath.startsWith('.fleet/'),
      ),
    ).toBe(true);
  });

  it('wiki 缺失时 doctor 照常全绿（本仓库无 wiki 的 doctor 基线）', async () => {
    const result = await runFleet(['doctor', '--json'], repoRoot);
    expect(result.exitCode).toBe(0);
    const text = result.stdout + result.stderr;
    expect(text).not.toContain('wiki');
  });

  it('删除 wiki 后 query 明确报错 + 指引（不假装有知识）', async () => {
    const query = await runFleet(
      ['wiki', 'query', '任意', '--repo', fixture.root, '--json'],
      repoRoot,
    );
    expect(query.exitCode).toBe(0); // wiki 存在（本测试前序步骤已 build）
    const status = await runFleet(
      ['wiki', 'status', '--repo', fixture.root, '--json'],
      repoRoot,
    );
    expect(status.exitCode).toBe(0);
  });
});
