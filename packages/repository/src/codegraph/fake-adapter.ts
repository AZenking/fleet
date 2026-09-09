import type {
  AdapterResult,
  CodeGraphAdapter,
  CodeGraphHealth,
  ImpactReport,
  SymbolEdge,
  SymbolHit,
} from './contract.js';
import { CODEGRAPH_CAPABILITIES } from './health.js';

/**
 * 假后端：构造参数脚本化各方法返回（research.md D6）。
 * 行为契约与真实实现一致——失败也走 { ok: false } 返回路径，不抛异常。
 */

export type ScriptedResult<T> =
  AdapterResult<T> | (() => AdapterResult<T> | Promise<AdapterResult<T>>);

export interface FakeAdapterScript {
  health?: CodeGraphHealth;
  search?: ScriptedResult<SymbolHit[]>;
  symbol?: ScriptedResult<SymbolHit[]>;
  callers?: ScriptedResult<SymbolEdge[]>;
  callees?: ScriptedResult<SymbolEdge[]>;
  impact?: ScriptedResult<ImpactReport>;
  explore?: ScriptedResult<string>;
}

async function resolve<T>(
  scripted: ScriptedResult<T> | undefined,
  fallback: T,
): Promise<AdapterResult<T>> {
  if (scripted === undefined) {
    return { ok: true, value: fallback };
  }
  return typeof scripted === 'function' ? await scripted() : scripted;
}

export const HEALTHY_FAKE_HEALTH: CodeGraphHealth = {
  available: true,
  initialized: true,
  indexFresh: true,
  pendingChanges: 0,
  capabilities: [...CODEGRAPH_CAPABILITIES],
};

export class FakeCodeGraphAdapter implements CodeGraphAdapter {
  constructor(private readonly script: FakeAdapterScript = {}) {}

  async health(): Promise<CodeGraphHealth> {
    return this.script.health ?? HEALTHY_FAKE_HEALTH;
  }

  async search(
    query: string,
    _limit?: number,
  ): Promise<AdapterResult<SymbolHit[]>> {
    void query;
    void _limit;
    return resolve(this.script.search, []);
  }

  async symbol(name: string): Promise<AdapterResult<SymbolHit[]>> {
    void name;
    return resolve(this.script.symbol, []);
  }

  async callers(symbol: string): Promise<AdapterResult<SymbolEdge[]>> {
    void symbol;
    return resolve(this.script.callers, []);
  }

  async callees(symbol: string): Promise<AdapterResult<SymbolEdge[]>> {
    void symbol;
    return resolve(this.script.callees, []);
  }

  async impact(symbol: string): Promise<AdapterResult<ImpactReport>> {
    void symbol;
    return resolve(this.script.impact, {
      symbol,
      depth: 0,
      nodeCount: 0,
      edgeCount: 0,
      affected: [],
    });
  }

  async explore(query: string): Promise<AdapterResult<string>> {
    void query;
    return resolve(this.script.explore, '');
  }
}
