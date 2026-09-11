import path from 'node:path';

import { RealFileSystem } from '@fleet/core';
import {
  CodeGraphCliAdapter,
  investigate,
  loadWikiPages,
  queryWiki,
  recentChangedFiles,
} from '@fleet/repository';

import type { ToolDefinition, ToolResult } from './types.js';

/**
 * Repository Intelligence 七工具（research.md D3）：全部为 M1–M3
 * 既有原语的薄组合（宪 VI）；降级语义与 CLI 同源（宪 I——加速器
 * 失效只降级不失败）。
 */

function strOf(args: Record<string, unknown>, key: string): string {
  return typeof args[key] === 'string' ? (args[key] as string) : '';
}

function repoRootOf(args: Record<string, unknown>): string {
  return strOf(args, 'repoRoot') || process.cwd();
}

export function buildRepoTools(): ToolDefinition[] {
  return [
    {
      name: 'repo_overview',
      description: '仓库概览：wiki 状态 + CodeGraph 健康 + 近期变更',
      inputSchema: {
        type: 'object',
        properties: {
          repoRoot: { type: 'string', description: '仓库根（缺省 cwd）' },
        },
      },
      handler: async (args) => {
        const repoRoot = repoRootOf(args);
        const adapter = new CodeGraphCliAdapter({ repoRoot });
        const health = await adapter.health();
        const changed = await recentChangedFiles(repoRoot, 7);
        const fs = new RealFileSystem();
        const wikiRoot = path.join(repoRoot, '.fleet', 'wiki');
        const loaded = loadWikiPages(fs, wikiRoot);
        return ok(
          JSON.stringify(
            {
              codegraph: health,
              wiki: {
                pages: loaded.pages.length,
                indexPresent: loaded.pages.some(
                  (page) => page.path === 'index.md',
                ),
              },
              recentChanges: changed,
            },
            null,
            2,
          ),
          {
            codegraph: health,
            wikiPages: loaded.pages.length,
            recentChanges: changed,
          },
        );
      },
    },
    {
      name: 'repo_investigate',
      description: '问题驱动调查：wiki/CodeGraph/搜索/源码回退链全量（宪法 I）',
      inputSchema: {
        type: 'object',
        properties: {
          question: { type: 'string', description: '调查问题' },
          repoRoot: { type: 'string' },
        },
        required: ['question'],
      },
      handler: async (args) => {
        const result = await investigate(strOf(args, 'question'), {
          repoRoot: repoRootOf(args),
        });
        return ok(JSON.stringify(result, null, 2).slice(0, 60_000), result);
      },
    },
    {
      name: 'repo_symbol',
      description: '符号直达查询（CodeGraph；不可用时结构化降级）',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          repoRoot: { type: 'string' },
        },
        required: ['name'],
      },
      handler: async (args) => {
        const adapter = new CodeGraphCliAdapter({ repoRoot: repoRootOf(args) });
        const result = await adapter.symbol(strOf(args, 'name'));
        return adapterResult(result, 'symbol');
      },
    },
    {
      name: 'repo_impact',
      description: '符号影响面（CodeGraph；不可用时结构化降级）',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: { type: 'string' },
          repoRoot: { type: 'string' },
        },
        required: ['symbol'],
      },
      handler: async (args) => {
        const adapter = new CodeGraphCliAdapter({ repoRoot: repoRootOf(args) });
        const result = await adapter.impact(strOf(args, 'symbol'));
        return adapterResult(result, 'impact');
      },
    },
    {
      name: 'repo_verify',
      description: '源码锚定核验（file:line 与内容一致性）',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string' },
          symbol: { type: 'string' },
          repoRoot: { type: 'string' },
        },
        required: ['filePath', 'symbol'],
      },
      handler: async (args) => {
        const reference = {
          filePath: strOf(args, 'filePath'),
          startLine: 1,
          symbol: strOf(args, 'symbol'),
        };
        const result = await investigate(
          `verify ${reference.symbol} @ ${reference.filePath}`,
          {
            repoRoot: repoRootOf(args),
            mode: 'verify',
          },
        );
        return ok(
          JSON.stringify(
            { verified: result.pathsUsed.includes('source') },
            null,
            2,
          ),
          {
            pathsUsed: result.pathsUsed,
          },
        );
      },
    },
    {
      name: 'wiki_query',
      description: 'LLM Wiki 检索（未建库时返回可 init 指引）',
      inputSchema: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          repoRoot: { type: 'string' },
        },
        required: ['question'],
      },
      handler: async (args) => {
        try {
          const result = await queryWiki(strOf(args, 'question'), {
            repoRoot: repoRootOf(args),
            fs: new RealFileSystem(),
          });
          return ok(JSON.stringify(result, null, 2).slice(0, 30_000), result);
        } catch {
          // 未建库：明确提示（不失败——spec US1 场景 5）
          return ok(
            JSON.stringify({
              state: 'missing',
              hint: 'wiki 未初始化——可先运行 fleet wiki init / wiki build',
            }),
            { state: 'missing' },
          );
        }
      },
    },
    {
      name: 'wiki_read',
      description: '读取 wiki 页面（路径白名单：.fleet/wiki/ 内，禁越界）',
      inputSchema: {
        type: 'object',
        properties: {
          pagePath: {
            type: 'string',
            description: '相对 .fleet/wiki/ 的页面路径',
          },
          repoRoot: { type: 'string' },
        },
        required: ['pagePath'],
      },
      handler: async (args) => {
        const repoRoot = repoRootOf(args);
        const wikiRoot = path.join(repoRoot, '.fleet', 'wiki');
        const resolved = path.resolve(wikiRoot, strOf(args, 'pagePath'));
        if (!resolved.startsWith(`${path.resolve(wikiRoot)}${path.sep}`)) {
          return fail(
            'path_forbidden',
            '页面路径越界',
            '仅允许 .fleet/wiki/ 内的相对路径',
          );
        }
        const loaded = loadWikiPages(new RealFileSystem(), wikiRoot);
        const page = loaded.pages.find(
          (p) => p.path === strOf(args, 'pagePath'),
        );
        if (page === undefined) {
          return fail('not_found', `页面不存在：${strOf(args, 'pagePath')}`);
        }
        const body = [
          page.manualBefore,
          page.generatedContent ?? '',
          page.manualAfter,
        ]
          .filter((part) => part.length > 0)
          .join('\n\n');
        return ok(`# ${page.path}\n\n${body}`.slice(0, 30_000), {
          path: page.path,
          section: page.section,
        });
      },
    },
  ];
}

function adapterResult<T>(
  result: {
    ok: boolean;
    value?: T;
    failure?: { code: string; detail: string };
  },
  kind: string,
): ToolResult {
  if (result.ok) {
    return ok(
      JSON.stringify(result.value ?? null, null, 2).slice(0, 30_000),
      result.value,
    );
  }
  // 宪法 I：加速器失效只降级不失败——结构化 fallback 返回
  return ok(
    JSON.stringify({
      degraded: true,
      kind,
      reason: result.failure?.detail ?? 'CodeGraph 不可用',
    }),
    { degraded: true, kind, code: result.failure?.code },
  );
}

function ok(text: string, payload?: unknown): ToolResult {
  return {
    ok: true,
    content: [{ type: 'text', text }],
    ...(payload !== undefined ? { payload } : {}),
  };
}

function fail(code: string, message: string, hint?: string): ToolResult {
  return { ok: false, code, message, ...(hint !== undefined ? { hint } : {}) };
}
