import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { McpServer } from './server.js';
import type { ToolDefinition } from './types.js';

/**
 * T002 协议矩阵：握手前置 / 坏 JSON / 未知方法 / notifications 忽略 /
 * 工具级错误不击穿 / 顺序处理 / EOF 退出（注入流驱动）。
 */

const echoTool: ToolDefinition = {
  name: 'test.echo',
  description: '回声',
  inputSchema: {
    type: 'object',
    properties: { message: { type: 'string' } },
    required: ['message'],
  },
  handler: async (args) => ({
    ok: true,
    content: [{ type: 'text', text: String(args.message) }],
  }),
};

const boomTool: ToolDefinition = {
  name: 'test.boom',
  description: '必抛',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    throw new Error('handler 崩溃');
  },
};

function serverOf(tools: ToolDefinition[] = [echoTool, boomTool]): McpServer {
  return new McpServer({ name: 'test', version: '0.0.1', tools });
}

describe('McpServer 协议矩阵', () => {
  it('initialize → 协议版本与能力；随后 tools/list 可用', async () => {
    const server = serverOf();
    const init = await server.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    });
    expect(init?.result).toMatchObject({
      protocolVersion: '2024-11-05',
      serverInfo: { name: 'test' },
    });
    const list = await server.handle({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });
    expect((list?.result as { tools: unknown[] }).tools).toHaveLength(2);
  });

  it('握手前 tools/* → -32602；未知方法 → -32601', async () => {
    const server = serverOf();
    const early = await server.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });
    expect(early?.error?.code).toBe(-32602);
    const unknown = await server.handle({
      jsonrpc: '2.0',
      id: 2,
      method: 'resources/list',
    });
    expect(unknown?.error?.code).toBe(-32601);
  });

  it('notifications（无 id）忽略；坏结构 → -32600', async () => {
    const server = serverOf();
    expect(
      await server.handle({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    ).toBeUndefined();
    expect((await server.handle('不是对象'))?.error?.code).toBe(-32600);
    expect((await server.handle({ jsonrpc: '2.0', id: 1 }))?.error?.code).toBe(
      -32600,
    );
  });

  it('tools/call：必填缺失 → -32602；未知工具 → -32602；成功 → content', async () => {
    const server = serverOf();
    await server.handle({ jsonrpc: '2.0', id: 0, method: 'initialize' });
    const missing = await server.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'test.echo', arguments: {} },
    });
    expect(missing?.error?.code).toBe(-32602);
    const unknown = await server.handle({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'nope', arguments: {} },
    });
    expect(unknown?.error?.code).toBe(-32602);
    const ok = await server.handle({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'test.echo', arguments: { message: '你好' } },
    });
    expect(ok?.result).toMatchObject({
      content: [{ type: 'text', text: '你好' }],
    });
  });

  it('handler 抛异常 → 工具级错误（isError），服务存活', async () => {
    const server = serverOf();
    await server.handle({ jsonrpc: '2.0', id: 0, method: 'initialize' });
    const boomed = await server.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'test.boom', arguments: {} },
    });
    expect(boomed?.result).toMatchObject({ isError: true });
    // 服务存活：后续调用照常
    const next = await server.handle({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'test.echo', arguments: { message: 'still alive' } },
    });
    expect(next?.result).toMatchObject({
      content: [{ type: 'text', text: 'still alive' }],
    });
  });

  it('stdio 循环：逐行协议 + 坏 JSON 行响应 -32700 + EOF 退出', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const server = new McpServer({
      name: 'test',
      version: '0.0.1',
      tools: [echoTool, boomTool],
      input,
      output,
    });
    const done = server.start();
    input.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
    input.write('这是坏 JSON\n');
    input.write('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');
    input.end();
    await done;
    const lines = output
      .read()
      .toString()
      .split('\n')
      .filter((l) => l.trim());
    const responses = lines.map(
      (line) => JSON.parse(line) as { id: unknown; error?: { code: number } },
    );
    expect(responses).toHaveLength(3);
    expect(responses[0]!.id).toBe(1);
    expect(responses[1]!.error?.code).toBe(-32700);
    expect(responses[2]!.id).toBe(2);
    void input;
  }, 10_000);
});
