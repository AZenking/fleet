/**
 * MCP 暴露域实体（data-model.md §1–§2）。
 *
 * 零依赖红线：协议最小面手写（initialize / tools/list / tools/call），
 * 不引入 SDK——宪法技术栈纪律。
 */

export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, { type: string; description?: string }>;
  required?: string[];
}

export interface ToolContent {
  type: 'text';
  text: string;
}

export type ToolResult =
  | { ok: true; content: ToolContent[]; payload?: unknown }
  | { ok: false; code: string; message: string; hint?: string };

export type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<ToolResult>;

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  handler: ToolHandler;
}

export const PROTOCOL_VERSION = '2024-11-05';

/** JSON-RPC 2.0 标准错误码（协议层） */
export const RPC_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
} as const;

export interface McpOptions {
  name: string;
  version: string;
  tools: ToolDefinition[];
  /** 测试注入（缺省 process.stdin/stdout） */
  input?: {
    on(event: 'close', listener: () => void): unknown;
  } & AsyncIterable<string> &
    NodeJS.ReadableStream;
  output?: { write(chunk: string): void };
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}
