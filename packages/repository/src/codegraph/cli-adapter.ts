import { execa } from 'execa';
import type {
  AdapterResult,
  CodeGraphAdapter,
  CodeGraphHealth,
  ImpactReport,
  SymbolEdge,
  SymbolHit,
} from './contract.js';
import {
  toCodeGraphHealth,
  UNAVAILABLE_HEALTH,
  extractLastIndexed,
  countFilesNewerThan,
} from './health.js';

/**
 * CLI 适配器：execa 驱动已安装的 codegraph（research.md D1）。
 *
 * 宪法 VI 红线：本适配器只调用只读命令（query/callers/callees/impact/
 * status/explore）。init / index / sync / uninit / daemon 一律禁止——
 * 索引是 CodeGraph 的资产，Fleet 只读不写。
 */

export interface CliAdapterOptions {
  repoRoot: string;
  timeoutMs?: number;
  command?: string;
}

interface RawQueryItem {
  node?: {
    name?: unknown;
    qualifiedName?: unknown;
    kind?: unknown;
    filePath?: unknown;
    startLine?: unknown;
    endLine?: unknown;
    language?: unknown;
    isExported?: unknown;
  };
}

interface RawRelation {
  symbol?: unknown;
  callers?: unknown;
  callees?: unknown;
  affected?: unknown;
  depth?: unknown;
  nodeCount?: unknown;
  edgeCount?: unknown;
}

function isENOENT(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'ENOENT' || String(error).includes('ENOENT');
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stderrFirstLine(stderr: string): string {
  return (
    stderr
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) ?? '未知错误'
  );
}

export class CodeGraphCliAdapter implements CodeGraphAdapter {
  private readonly command: string;
  private readonly timeoutMs: number;
  private readonly repoRoot: string;

  constructor(options: CliAdapterOptions) {
    this.command = options.command ?? 'codegraph';
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.repoRoot = options.repoRoot;
  }

  private async runJson<T>(args: string[]): Promise<AdapterResult<T>> {
    try {
      const result = await execa(this.command, args, {
        cwd: this.repoRoot,
        timeout: this.timeoutMs,
        reject: false,
      });
      if (result.timedOut) {
        return {
          ok: false,
          failure: {
            code: 'timeout',
            detail: `codegraph ${args[0]} 超过 ${this.timeoutMs}ms`,
          },
        };
      }
      if (result.exitCode !== 0) {
        // reject:false 下 ENOENT 不抛异常：exitCode 为 undefined，
        // 标志藏在 result.message（"spawn xxx ENOENT"）
        const output = `${result.message ?? ''}\n${result.stderr}\n${result.stdout}`;
        if (output.includes('ENOENT')) {
          return {
            ok: false,
            failure: {
              code: 'unavailable',
              detail: `命令不存在：${this.command}`,
            },
          };
        }
        return {
          ok: false,
          failure: { code: 'error', detail: stderrFirstLine(result.stderr) },
        };
      }
      try {
        return { ok: true, value: JSON.parse(result.stdout) as T };
      } catch {
        return {
          ok: false,
          failure: {
            code: 'error',
            detail: `codegraph ${args[0]} 输出不是合法 JSON`,
          },
        };
      }
    } catch (error) {
      if (isENOENT(error)) {
        return {
          ok: false,
          failure: {
            code: 'unavailable',
            detail: `命令不存在：${this.command}`,
          },
        };
      }
      return { ok: false, failure: { code: 'error', detail: describe(error) } };
    }
  }

  async health(): Promise<CodeGraphHealth> {
    const result = await this.runJson<unknown>(['status', '--json']);
    if (!result.ok) {
      return { ...UNAVAILABLE_HEALTH };
    }
    const health = toCodeGraphHealth(result.value);
    // 第二层 stale 检测：status 不感知实时修改，用文件 mtime 对比 lastIndexed
    if (health.available && health.initialized && health.indexFresh) {
      const lastIndexed = extractLastIndexed(result.value);
      if (lastIndexed !== undefined) {
        const drift = countFilesNewerThan(this.repoRoot, lastIndexed);
        if (drift > 0) {
          return { ...health, indexFresh: false, pendingChanges: drift };
        }
      }
    }
    return health;
  }

  async search(query: string, limit = 10): Promise<AdapterResult<SymbolHit[]>> {
    const result = await this.runJson<unknown>([
      'query',
      query,
      '--json',
      '--limit',
      String(limit),
    ]);
    if (!result.ok) {
      return result;
    }
    if (!Array.isArray(result.value)) {
      return {
        ok: false,
        failure: { code: 'error', detail: 'query 结果不是数组' },
      };
    }
    const hits: SymbolHit[] = [];
    for (const item of result.value as RawQueryItem[]) {
      const node = item?.node;
      if (
        typeof node?.name === 'string' &&
        typeof node?.kind === 'string' &&
        typeof node?.filePath === 'string' &&
        typeof node?.startLine === 'number' &&
        typeof node?.endLine === 'number'
      ) {
        hits.push({
          name: node.name,
          qualifiedName:
            typeof node.qualifiedName === 'string'
              ? node.qualifiedName
              : undefined,
          kind: node.kind,
          filePath: node.filePath,
          startLine: node.startLine,
          endLine: node.endLine,
          language:
            typeof node.language === 'string' ? node.language : undefined,
          isExported:
            typeof node.isExported === 'boolean' ? node.isExported : undefined,
        });
      }
    }
    return { ok: true, value: hits };
  }

  async symbol(name: string): Promise<AdapterResult<SymbolHit[]>> {
    const result = await this.search(name, 20);
    if (!result.ok) {
      return result;
    }
    return { ok: true, value: result.value.filter((hit) => hit.name === name) };
  }

  private async relation(
    kind: 'callers' | 'callees',
    symbol: string,
  ): Promise<AdapterResult<SymbolEdge[]>> {
    const result = await this.runJson<RawRelation>([kind, symbol, '--json']);
    if (!result.ok) {
      return result;
    }
    const raw =
      kind === 'callers' ? result.value.callers : result.value.callees;
    if (!Array.isArray(raw)) {
      return {
        ok: false,
        failure: { code: 'error', detail: `${kind} 结果不是数组` },
      };
    }
    const edges: SymbolEdge[] = [];
    for (const edge of raw) {
      const e = edge as RawQueryItem['node'];
      if (
        typeof e?.name === 'string' &&
        typeof e?.kind === 'string' &&
        typeof e?.filePath === 'string' &&
        typeof e?.startLine === 'number'
      ) {
        edges.push({
          name: e.name,
          kind: e.kind,
          filePath: e.filePath,
          startLine: e.startLine,
        });
      }
    }
    return { ok: true, value: edges };
  }

  async callers(symbol: string): Promise<AdapterResult<SymbolEdge[]>> {
    return this.relation('callers', symbol);
  }

  async callees(symbol: string): Promise<AdapterResult<SymbolEdge[]>> {
    return this.relation('callees', symbol);
  }

  async impact(symbol: string): Promise<AdapterResult<ImpactReport>> {
    const result = await this.runJson<RawRelation>([
      'impact',
      symbol,
      '--json',
    ]);
    if (!result.ok) {
      return result;
    }
    const affectedRaw = result.value.affected;
    if (!Array.isArray(affectedRaw)) {
      return {
        ok: false,
        failure: { code: 'error', detail: 'impact 结果缺少 affected' },
      };
    }
    const affected: SymbolEdge[] = [];
    for (const edge of affectedRaw) {
      const e = edge as RawQueryItem['node'];
      if (
        typeof e?.name === 'string' &&
        typeof e?.kind === 'string' &&
        typeof e?.filePath === 'string' &&
        typeof e?.startLine === 'number'
      ) {
        affected.push({
          name: e.name,
          kind: e.kind,
          filePath: e.filePath,
          startLine: e.startLine,
        });
      }
    }
    return {
      ok: true,
      value: {
        symbol:
          typeof result.value.symbol === 'string'
            ? result.value.symbol
            : symbol,
        depth: typeof result.value.depth === 'number' ? result.value.depth : 0,
        nodeCount:
          typeof result.value.nodeCount === 'number'
            ? result.value.nodeCount
            : affected.length,
        edgeCount:
          typeof result.value.edgeCount === 'number'
            ? result.value.edgeCount
            : 0,
        affected,
      },
    };
  }

  async explore(query: string): Promise<AdapterResult<string>> {
    try {
      const result = await execa(this.command, ['explore', query], {
        cwd: this.repoRoot,
        timeout: this.timeoutMs,
        reject: false,
      });
      if (result.timedOut) {
        return {
          ok: false,
          failure: {
            code: 'timeout',
            detail: `codegraph explore 超过 ${this.timeoutMs}ms`,
          },
        };
      }
      if (result.exitCode !== 0) {
        return {
          ok: false,
          failure: { code: 'error', detail: stderrFirstLine(result.stderr) },
        };
      }
      return { ok: true, value: result.stdout };
    } catch (error) {
      if (isENOENT(error)) {
        return {
          ok: false,
          failure: {
            code: 'unavailable',
            detail: `命令不存在：${this.command}`,
          },
        };
      }
      return { ok: false, failure: { code: 'error', detail: describe(error) } };
    }
  }
}
