import { z } from 'zod';

/**
 * CodeGraphAdapter 能力面契约（contracts/codegraph-adapter.md）。
 * 消费者只依赖本接口；失败一律以 AdapterResult 返回，不抛异常（FR-004）.
 */

export const codegraphFailureCodeSchema = z.enum([
  'unavailable',
  'timeout',
  'error',
  'stale',
]);
export type CodegraphFailureCode = z.infer<typeof codegraphFailureCodeSchema>;

export interface CodeGraphFailure {
  code: CodegraphFailureCode;
  detail: string;
}

export type AdapterResult<T> =
  { ok: true; value: T } | { ok: false; failure: CodeGraphFailure };

export const symbolHitSchema = z.object({
  name: z.string(),
  qualifiedName: z.string().optional(),
  kind: z.string(),
  filePath: z.string(),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  language: z.string().optional(),
  isExported: z.boolean().optional(),
});
export type SymbolHit = z.infer<typeof symbolHitSchema>;

export interface SymbolEdge {
  name: string;
  kind: string;
  filePath: string;
  startLine: number;
}

export interface ImpactReport {
  symbol: string;
  depth: number;
  nodeCount: number;
  edgeCount: number;
  affected: SymbolEdge[];
}

export interface CodeGraphHealth {
  available: boolean;
  initialized: boolean;
  version?: string;
  indexFresh: boolean;
  pendingChanges: number;
  capabilities: string[];
}

export interface CodeGraphAdapter {
  health(): Promise<CodeGraphHealth>;
  search(query: string, limit?: number): Promise<AdapterResult<SymbolHit[]>>;
  symbol(name: string): Promise<AdapterResult<SymbolHit[]>>;
  callers(symbol: string): Promise<AdapterResult<SymbolEdge[]>>;
  callees(symbol: string): Promise<AdapterResult<SymbolEdge[]>>;
  impact(symbol: string): Promise<AdapterResult<ImpactReport>>;
  explore(query: string): Promise<AdapterResult<string>>;
}
