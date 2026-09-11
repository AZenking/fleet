import { createInterface } from 'node:readline';

import {
  PROTOCOL_VERSION,
  RPC_ERRORS,
  type JsonRpcResponse,
  type McpOptions,
  type ToolDefinition,
} from './types.js';

/**
 * McpServer（research.md D1/D2）：stdio JSON-RPC 2.0 最小协议面。
 * 逐行读、逐个答（顺序处理，单客户端语义）；notifications（无 id）
 * 静默忽略；handler 异常 → 工具级错误（服务零崩溃）。
 */

export class McpServer {
  private initialized = false;

  constructor(private readonly options: McpOptions) {}

  /** 单请求处理（协议层入口——测试可直接调；返回 undefined = notification） */
  async handle(request: unknown): Promise<JsonRpcResponse | undefined> {
    if (typeof request !== 'object' || request === null) {
      return errorOf(null, RPC_ERRORS.invalidRequest, '请求必须是 JSON 对象');
    }
    const { id, method, params } = request as {
      id?: number | string | null;
      method?: unknown;
      params?: unknown;
    };
    if (typeof method !== 'string' || method.length === 0) {
      return errorOf(id ?? null, RPC_ERRORS.invalidRequest, '缺少 method');
    }

    if (id === undefined) {
      return undefined; // notification——静默忽略
    }
    try {
      return await this.dispatch(id, method, params);
    } catch (cause) {
      const rpcCode = (cause as { rpcCode?: number }).rpcCode;
      if (rpcCode !== undefined) {
        return errorOf(
          id,
          rpcCode,
          cause instanceof Error ? cause.message : String(cause),
        );
      }
      return errorOf(
        id,
        RPC_ERRORS.invalidRequest,
        `内部错误：${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }

  private async dispatch(
    id: number | string | null,
    method: string,
    params: unknown,
  ): Promise<JsonRpcResponse> {
    if (method === 'initialize') {
      this.initialized = true;
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: {
            name: this.options.name,
            version: this.options.version,
          },
        },
      };
    }
    if (method === 'tools/list') {
      this.requireInitialized();
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: this.options.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        },
      };
    }
    if (method === 'tools/call') {
      this.requireInitialized();
      const { name, arguments: args } = (params ?? {}) as {
        name?: unknown;
        arguments?: unknown;
      };
      if (typeof name !== 'string') {
        return errorOf(id, RPC_ERRORS.invalidParams, 'tools/call 缺少 name');
      }
      const tool = this.options.tools.find((entry) => entry.name === name);
      if (tool === undefined) {
        return errorOf(id, RPC_ERRORS.invalidParams, `未知工具：${name}`);
      }
      const callArgs =
        typeof args === 'object' && args !== null
          ? (args as Record<string, unknown>)
          : {};
      const missing = missingRequired(tool, callArgs);
      if (missing.length > 0) {
        return errorOf(
          id,
          RPC_ERRORS.invalidParams,
          `工具 ${name} 缺少必填参数：${missing.join(', ')}`,
        );
      }
      let result;
      try {
        result = await tool.handler(callArgs);
      } catch (cause) {
        // handler 异常 = 工具级错误（服务零崩溃）
        result = {
          ok: false,
          code: 'handler_error',
          message: cause instanceof Error ? cause.message : String(cause),
        };
      }
      if (!result.ok) {
        // 工具级错误进 result（isError 语义）——服务不崩
        return {
          jsonrpc: '2.0',
          id,
          result: {
            isError: true,
            content: [
              {
                type: 'text',
                text: `${result.code}: ${result.message}${result.hint !== undefined ? `（${result.hint}）` : ''}`,
              },
            ],
          },
        };
      }
      return { jsonrpc: '2.0', id, result: { content: result.content } };
    }
    return errorOf(id, RPC_ERRORS.methodNotFound, `未知方法：${method}`);
  }

  private requireInitialized(): void {
    if (!this.initialized) {
      throw Object.assign(new Error('initialize 前置'), {
        rpcCode: RPC_ERRORS.invalidParams,
      });
    }
  }

  /** stdio 循环：逐行顺序处理；resolve 于输入流 EOF（事件驱动） */
  start(): Promise<void> {
    const input = this.options.input ?? process.stdin;
    const output = this.options.output ?? process.stdout;
    const lines = createInterface({ input });
    return new Promise<void>((resolve) => {
      let chain: Promise<void> = Promise.resolve();
      lines.on('line', (line: string) => {
        const trimmed = line.trim();
        if (trimmed.length === 0) {
          return;
        }
        // 顺序处理：上一行完成后处理下一行（单客户端语义）
        chain = chain.then(async () => {
          let request: unknown;
          try {
            request = JSON.parse(trimmed);
          } catch {
            writeLine(output, {
              jsonrpc: '2.0',
              id: null,
              error: { code: RPC_ERRORS.parse, message: 'JSON 解析失败' },
            });
            return;
          }
          const response = await this.handle(request);
          if (response !== undefined) {
            writeLine(output, response);
          }
        });
      });
      lines.on('close', () => {
        void chain.then(() => resolve());
      });
    });
  }
}

function missingRequired(
  tool: ToolDefinition,
  args: Record<string, unknown>,
): string[] {
  return (tool.inputSchema.required ?? []).filter(
    (key) => args[key] === undefined,
  );
}

function writeLine(
  output: { write(chunk: string): void },
  payload: unknown,
): void {
  output.write(`${JSON.stringify(payload)}\n`);
}

function errorOf(
  id: number | string | null, // null id 用于 parse 错误等无请求 id 场景
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}
