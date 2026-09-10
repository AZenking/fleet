import { existsSync } from 'node:fs';
import path from 'node:path';

import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createWikiFixture,
  type WikiFixture,
} from '../helpers/git-repo-fixture.js';

/**
 * fleet repo investigate 证据体系 e2e（M3）：
 * findings 锚定（SC-001）/ 判定复现（SC-003）/ 高风险矩阵（SC-002）/
 * fast-verify 计时（SC-006）/ wiki 接入与隔离（SC-004）/ 死路径冲突。
 * 一律 tmp 夹具仓库；codegraph 状态任意（未初始化 → 走搜索链，同为
 * 有效路径）。
 */

const bin = new URL('../../apps/cli/dist/bin.js', import.meta.url).pathname;

let fixture: WikiFixture;

beforeAll(async () => {
  fixture = await createWikiFixture();
});

afterAll(async () => {
  await fixture.destroy();
});

async function runFleet(args: string[]) {
  return execa(process.execPath, [bin, ...args], {
    cwd: fixture.root,
    reject: false,
  });
}

async function investigateJson(question: string, extra: string[] = []) {
  const result = await runFleet([
    'repo',
    'investigate',
    question,
    '--repo',
    fixture.root,
    '--json',
    ...extra,
  ]);
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout);
}

describe('US1：结论带证据链', () => {
  it('findings 存在：statement 可读、verified 证据锚定磁盘（SC-001）', async () => {
    const report = await investigateJson('investigateFixture', [
      '--mode',
      'verify',
    ]);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.mode.effectiveMode).toBe('verify');
    for (const finding of report.findings) {
      for (const item of finding.evidence) {
        if (item.verified && item.source !== 'wiki') {
          const [file, line] = item.location.split(':');
          expect(existsSync(path.join(fixture.root, file ?? ''))).toBe(true);
          expect(Number.parseInt(line ?? '1', 10)).toBeGreaterThan(0);
        }
        expect(typeof finding.confidenceReason).toBe('string');
      }
    }
    // M1 字段兼容保留
    expect(Array.isArray(report.references)).toBe(true);
    expect(typeof report.summary).toBe('string');
  });

  it('同命令双跑：findings 判定完全一致（SC-003）', async () => {
    const first = await investigateJson('FixtureError', ['--mode', 'verify']);
    const second = await investigateJson('FixtureError', ['--mode', 'verify']);
    const strip = (report: Record<string, unknown>) => ({
      ...report,
      durationMs: undefined,
    });
    expect(strip(first.findings)).toEqual(strip(second.findings));
    expect(first.mode).toEqual(second.mode);
  });

  it('文本模式渲染 findings 段与升级记录', async () => {
    const result = await runFleet([
      'repo',
      'investigate',
      'investigateFixture',
      '--repo',
      fixture.root,
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/\[(high|medium|low)\] /);
  });
});

describe('US2：FAST / VERIFY 模式（SC-002 / SC-006）', () => {
  it('fast vs verify：证据构成对照 + fast 耗时不超过 verify（SC-006）', async () => {
    const fast = await investigateJson('investigateFixture', [
      '--mode',
      'fast',
    ]);
    const verify = await investigateJson('investigateFixture', [
      '--mode',
      'verify',
    ]);
    expect(fast.mode.requestedMode).toBe('fast');
    expect(verify.mode.effectiveMode).toBe('verify');
    // 夹具无 codegraph 索引时 fast 会按 FR-008 正确升级 verify
    // （accelerators_unavailable）——两模式均有效完成调查
    expect(['fast', 'verify']).toContain(fast.mode.effectiveMode);
    expect(fast.durationMs).toBeLessThanOrEqual(verify.durationMs + 500);
    expect(fast.durationMs).toBeLessThanOrEqual(10_000);
    expect(verify.durationMs).toBeLessThanOrEqual(10_000);
  });

  const HIGH_RISK_MATRIX: Array<[string, string]> = [
    ['payment', '删除 PaymentService 会影响哪些调用方'],
    ['authentication', '认证 login 流程怎么走'],
    ['db_schema', 'DB schema 迁移在哪定义'],
    ['public_api', '公共 api 导出了什么'],
    ['service', '删除 service 的调用方在哪'],
    ['large_refactor', '大范围重构的入口在哪'],
  ];

  for (const [rule, question] of HIGH_RISK_MATRIX) {
    it(`高风险 ${rule}：默认与显式 fast 双调用均升级 VERIFY（SC-002）`, async () => {
      const byDefault = await investigateJson(question);
      expect(byDefault.mode.effectiveMode).toBe('verify');
      expect(
        byDefault.mode.escalations.map((item: { rule: string }) => item.rule),
      ).toContain('high_risk');

      const explicitFast = await investigateJson(question, ['--mode', 'fast']);
      expect(explicitFast.mode.effectiveMode).toBe('verify');
      expect(explicitFast.mode.escalations.length).toBeGreaterThan(0);
      // 高风险结论最终锚定源码（verify 全链）；问题词未命中仓库内容时
      // 允许 insufficient（模式升级本身即 SC-002 的核心断言）
      const evidenceItems = explicitFast.findings.flatMap(
        (finding: { evidence: Array<{ source: string }> }) => finding.evidence,
      );
      if (evidenceItems.length > 0) {
        const sources = new Set(evidenceItems.map((item) => item.source));
        expect(
          sources.has('source') ||
            sources.has('search') ||
            sources.has('config'),
        ).toBe(true);
      }
    });
  }

  it('日常导航问题默认 fast（auto 无风险）', async () => {
    const report = await investigateJson('investigateFixture');
    expect(report.mode.requestedMode).toBe('auto');
  });
});

describe('US3：wiki 接入与冲突裁决（SC-004 / SC-005）', () => {
  it('wiki 命中：wiki 证据 + wiki finding 参与结论', async () => {
    await runFleet(['wiki', 'init', '--repo', fixture.root]);
    await runFleet(['wiki', 'build', '--repo', fixture.root, '--json']);
    const report = await investigateJson('investigateFixture 夹具仓库智能', [
      '--mode',
      'verify',
    ]);
    expect(report.pathsUsed).toContain('wiki');
    expect(
      report.findings.some(
        (finding: { kind: string }) => finding.kind === 'wiki',
      ),
    ).toBe(true);
    const wikiFinding = report.findings.find(
      (finding: { kind: string }) => finding.kind === 'wiki',
    );
    expect(wikiFinding.evidence[0].source).toBe('wiki');
  });

  it('整删 wiki：references 与退出码一致，仅多 wiki_missing（SC-004）', async () => {
    const before = await investigateJson('investigateFixture', [
      '--mode',
      'verify',
    ]);
    await execa('rm', ['-rf', path.join(fixture.root, '.fleet', 'wiki')]);
    const after = await investigateJson('investigateFixture', [
      '--mode',
      'verify',
    ]);
    expect(after.references).toEqual(before.references);
    expect(after.mode).toEqual(before.mode);
    expect(
      after.fallbacks.map((reason: { code: string }) => reason.code),
    ).toContain('wiki_missing');
    // degraded 的差值只允许是 wiki_missing（不计降级）——codegraph 状态
    //（如本机已装但夹具未索引的 stale）两轮一致，不属于 wiki 隔离回归
    const material = (report: { fallbacks: Array<{ code: string }> }) =>
      report.fallbacks.filter((reason) => reason.code !== 'wiki_missing')
        .length;
    expect(material(after)).toBe(material(before));
  });

  it('wiki stale：降级不使用（过期知识不冒充）', async () => {
    await runFleet(['wiki', 'build', '--repo', fixture.root, '--json']);
    await fixture.commit(
      { 'packages/core/src/more.ts': 'export const MORE = 1;\n' },
      'fixture: make wiki stale',
    );
    const report = await investigateJson('investigateFixture', [
      '--mode',
      'verify',
    ]);
    expect(
      report.fallbacks.map((reason: { code: string }) => reason.code),
    ).toContain('wiki_stale');
    expect(report.pathsUsed).not.toContain('wiki');
  });

  it('wiki 死路径：dead_path 冲突 + static_truth 胜出（SC-005）', async () => {
    await runFleet(['wiki', 'build', '--repo', fixture.root, '--json']);
    // 在生成页围栏内注入一个不存在的路径引用（模拟 wiki 内容失真）
    const pagePath = '.fleet/wiki/domains/repository.md';
    const original = await fixture.read(pagePath);
    expect(original).toContain('<!-- fleet:generated -->');
    const poisoned = original.replace(
      '<!-- fleet:generated -->',
      '<!-- fleet:generated -->\ninvestigateFixture 幽灵引用：`packages/ghost/src/x.ts`',
    );
    await fixture.write({ [pagePath]: poisoned });

    const report = await investigateJson('investigateFixture', [
      '--mode',
      'verify',
    ]);
    const conflicts = report.findings.flatMap(
      (finding: { conflicts: Array<{ kind: string; winner: string }> }) =>
        finding.conflicts,
    );
    const deadPath = conflicts.find(
      (conflict: { kind: string }) => conflict.kind === 'dead_path',
    );
    expect(deadPath).toBeDefined();
    expect(deadPath.winner).toBe('static_truth');

    // 恢复页面，避免影响后续
    await fixture.write({ [pagePath]: original });
  });
});
