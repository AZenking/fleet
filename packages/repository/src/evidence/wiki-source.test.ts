import { describe, expect, it } from 'vitest';

import { MemoryFileSystem } from '@fleet/core';

import { FakeCodeGraphAdapter } from '../codegraph/fake-adapter.js';
import { investigate } from '../investigation/investigate.js';
import { FakeWikiGit } from '../wiki/git.js';
import { collectWikiEvidence } from './wiki-source.js';

/**
 * M3 编排与 wiki 证据源单元测试（tasks.md T013/T017）：
 * 模式贯穿（fast 跳锚定/零命中升级）+ wiki 四态 + 冲突接线。
 * 全部 MemoryFileSystem + Fake 注入，确定性。
 */

const SHA1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SHA2 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const FILES: Record<string, string> = {
  'src/a.ts': 'export function targetFunc() {\n  return 1;\n}\n',
  'src/b.ts':
    'import { targetFunc } from "./a.js";\nexport function caller() {\n  return targetFunc();\n}\n',
  'config/rates.yaml': 'max_charge: 500\ncurrency: USD\n',
};

function memoryRepo(files: Record<string, string>): {
  fs: MemoryFileSystem;
  repoRoot: string;
} {
  const fs = new MemoryFileSystem();
  for (const [name, content] of Object.entries(files)) {
    fs.writeFile(`/repo/${name}`, content);
  }
  return { fs, repoRoot: '/repo' };
}

function wikiFiles(
  pages: Record<string, string>,
  anchor = SHA1,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(pages).map(([name, body]) => [
      `.fleet/wiki/${name}`,
      [
        '---',
        `title: ${name}`,
        ...(anchor !== undefined ? [`generated_from: ${anchor}`] : []),
        'updated_at: 2026-09-10T00:00:00.000Z',
        'scope:',
        '  - .',
        '---',
        '',
        body,
        '',
      ].join('\n'),
    ]),
  );
}

describe('collectWikiEvidence（四态，research.md D4）', () => {
  it('missing：无 wiki → wiki_missing 降级码', async () => {
    const { fs, repoRoot } = memoryRepo(FILES);
    const outcome = await collectWikiEvidence('targetFunc', {
      repoRoot,
      fs,
      forceWalk: true,
    });
    expect(outcome.state).toBe('missing');
    expect(outcome.fallback?.code).toBe('wiki_missing');
  });

  it('broken：页面损坏 → wiki_broken', async () => {
    const { fs, repoRoot } = memoryRepo(FILES);
    fs.writeFile('/repo/.fleet/wiki/index.md', '没有 front matter 的损坏页');
    const outcome = await collectWikiEvidence('targetFunc', {
      repoRoot,
      fs,
      forceWalk: true,
    });
    expect(outcome.state).toBe('broken');
    expect(outcome.fallback?.code).toBe('wiki_broken');
  });

  it('stale：锚点落后 HEAD → 不使用（过期知识不冒充）', async () => {
    const { fs, repoRoot } = memoryRepo({
      ...FILES,
      ...wikiFiles({ 'index.md': '# Wiki\n\ntargetFunc 相关\n' }, SHA1),
    });
    const outcome = await collectWikiEvidence('targetFunc', {
      repoRoot,
      fs,
      git: new FakeWikiGit({ headSha: SHA2 }),
      forceWalk: true,
    });
    expect(outcome.state).toBe('stale');
    expect(outcome.fallback?.code).toBe('wiki_stale');
    expect(outcome.evidence).toEqual([]);
  });

  it('hit：命中 → wiki 证据锚定页面；死路径 → dead_path 冲突', async () => {
    const { fs, repoRoot } = memoryRepo({
      ...FILES,
      ...wikiFiles({
        'index.md': '# Wiki\n',
        'domains/a.md':
          '<!-- fleet:generated -->\ntargetFunc 位于 `src/a.ts`，幽灵在 `packages/ghost/src/x.ts`\n<!-- /fleet:generated -->\n',
      }),
    });
    const outcome = await collectWikiEvidence('targetFunc', {
      repoRoot,
      fs,
      forceWalk: true,
    });
    expect(outcome.state).toBe('hit');
    expect(
      outcome.evidence.some((item) => item.location === 'domains/a.md'),
    ).toBe(true);
    expect(outcome.evidence.every((item) => item.verified)).toBe(true);
    expect(outcome.conflicts.map((conflict) => conflict.kind)).toContain(
      'dead_path',
    );
    const dead = outcome.conflicts.find(
      (conflict) => conflict.kind === 'dead_path',
    );
    expect(dead?.accelerated.claim).toContain('packages/ghost/src/x.ts');
    expect(dead?.winner).toBe('static_truth');
  });
});

describe('investigate 模式贯穿（research.md D3 / FR-004/008）', () => {
  const healthySymbol = {
    ok: true as const,
    value: [
      {
        name: 'targetFunc',
        kind: 'function',
        filePath: 'src/a.ts',
        startLine: 2,
        endLine: 4,
      },
    ],
  };

  it('fast：codegraph 证据 verified=false、confidence ≤ medium', async () => {
    const { fs, repoRoot } = memoryRepo(FILES);
    const result = await investigate('targetFunc', {
      repoRoot,
      fs,
      adapter: new FakeCodeGraphAdapter({ symbol: healthySymbol }),
      forceWalkSearch: true,
      mode: 'fast',
    });
    expect(result.mode?.effectiveMode).toBe('fast');
    expect(result.pathsUsed).not.toContain('source');
    const symbolFinding = result.findings?.find((f) => f.kind === 'symbol');
    expect(symbolFinding?.evidence.every((item) => !item.verified)).toBe(true);
    expect(
      ['medium', 'low'].includes(symbolFinding?.confidence ?? 'high'),
    ).toBe(true);
  });

  it('verify：全链锚定 → verified=true，可到 high', async () => {
    const { fs, repoRoot } = memoryRepo(FILES);
    const result = await investigate('targetFunc', {
      repoRoot,
      fs,
      adapter: new FakeCodeGraphAdapter({
        symbol: {
          ok: true,
          value: [
            {
              name: 'targetFunc',
              kind: 'function',
              filePath: 'src/a.ts',
              startLine: 1,
              endLine: 3,
            },
          ],
        },
      }),
      forceWalkSearch: true,
      mode: 'verify',
    });
    expect(result.mode?.effectiveMode).toBe('verify');
    const symbolFinding = result.findings?.find((f) => f.kind === 'symbol');
    // verifyAnchor 复核后 codegraph 证据 verified=true（源码背书）
    expect(symbolFinding?.evidence.some((item) => item.verified)).toBe(true);
    expect(symbolFinding?.confidence).toBe('medium');
  });

  it('fast 零命中 → zero_hits 升级走 VERIFY 底层链', async () => {
    const { fs, repoRoot } = memoryRepo(FILES);
    const result = await investigate('NothingMatches', {
      repoRoot,
      fs,
      adapter: new FakeCodeGraphAdapter({ symbol: { ok: true, value: [] } }),
      forceWalkSearch: true,
      mode: 'fast',
    });
    expect(result.mode?.effectiveMode).toBe('verify');
    expect(result.mode?.escalations.map((item) => item.rule)).toContain(
      'zero_hits',
    );
    expect(result.pathsUsed).toContain('search');
  });

  it('fast 加速源不可用 → accelerators_unavailable 升级', async () => {
    const { fs, repoRoot } = memoryRepo(FILES);
    const result = await investigate('targetFunc', {
      repoRoot,
      fs,
      adapter: new FakeCodeGraphAdapter({
        health: {
          available: false,
          initialized: false,
          indexFresh: false,
          pendingChanges: 0,
          capabilities: [],
        },
      }),
      forceWalkSearch: true,
      mode: 'fast',
    });
    expect(result.mode?.escalations.map((item) => item.rule)).toContain(
      'accelerators_unavailable',
    );
    expect(result.pathsUsed).toContain('search');
    expect(result.references.length).toBeGreaterThan(0);
  });

  it('config 重分类端到端：配置命中成为 config 证据（D5）', async () => {
    const { fs, repoRoot } = memoryRepo({
      ...FILES,
      'src/payment.ts': 'export class PaymentService {\n  charge() {}\n}\n',
    });
    const result = await investigate('PaymentService charge', {
      repoRoot,
      fs,
      adapter: new FakeCodeGraphAdapter(),
      forceWalkSearch: true,
      mode: 'verify',
    });
    const sources = new Set(
      (result.findings ?? []).flatMap((finding) =>
        finding.evidence.map((item) => item.source),
      ),
    );
    // PaymentService 命中高风险表 → verify；搜索扫到 rates.yaml → config
    expect(result.mode?.effectiveMode).toBe('verify');
    expect(sources.has('config')).toBe(true);
  });

  it('锚点偏移 → anchor_offset 冲突挂靠符号 finding（SC-005 单元）', async () => {
    const { fs, repoRoot } = memoryRepo(FILES);
    const result = await investigate('targetFunc', {
      repoRoot,
      fs,
      adapter: new FakeCodeGraphAdapter({
        symbol: {
          ok: true,
          value: [
            {
              name: 'targetFunc',
              kind: 'function',
              filePath: 'src/a.ts',
              startLine: 3,
              endLine: 5,
            },
          ],
        },
      }),
      forceWalkSearch: true,
      mode: 'verify',
    });
    // startLine=3 处不是符号（在第 1 行）→ verifyAnchor 修正 + conflict
    const symbolFinding = result.findings?.find((f) => f.kind === 'symbol');
    const conflict = symbolFinding?.conflicts.find(
      (item) => item.kind === 'anchor_offset',
    );
    expect(conflict?.accelerated.location).toBe('src/a.ts:3');
    expect(conflict?.truth.location).toBe('src/a.ts:1');
    expect(conflict?.winner).toBe('static_truth');
    expect(symbolFinding?.confidence).toBe('low');
  });
});
