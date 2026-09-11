import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * M12 e2e：独立 MCP 客户端进程（spawn + stdio JSON-RPC）驱动两服务
 * 全工作流——SC-001 握手与清单 / SC-002 repo 七工具 / SC-003 fleet
 * 五工具 / SC-004 协议健壮性。
 */

const bin = new URL('../../apps/cli/dist/bin.js', import.meta.url).pathname;
const fixtureRoot = new URL('../fixtures/', import.meta.url).pathname;

interface RpcResponse {
  id: number;
  result?: {
    content?: Array<{ type: string; text: string }>;
    isError?: boolean;
    tools?: Array<{ name: string }>;
    protocolVersion?: string;
  };
  error?: { code: number; message: string };
}

/** 极简 MCP 客户端：spawn 服务进程 + 逐行 JSON-RPC */
async function withClient(
  server: 'repo' | 'fleet',
  cwd: string,
  requests: Array<Record<string, unknown>>,
): Promise<Map<number, RpcResponse>> {
  const child = execa(process.execPath, [bin, 'mcp', server], {
    cwd,
    reject: false,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'ignore',
  });
  const input = child.stdin!;
  const responses = new Map<number, RpcResponse>();
  const pending = new Promise<void>((resolve) => {
    let buffer = '';
    child.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.length > 0) {
          try {
            const parsed = JSON.parse(line) as RpcResponse;
            if (parsed.id !== null && parsed.id !== undefined) {
              responses.set(Number(parsed.id), parsed);
            }
          } catch {
            // 非 JSON 行忽略
          }
        }
        newline = buffer.indexOf('\n');
      }
    });
    child.stdout!.on('end', () => resolve());
  });

  const all = [
    { jsonrpc: '2.0', id: 0, method: 'initialize', params: {} },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    ...requests.map((request, index) => ({
      jsonrpc: '2.0',
      id: index + 1,
      method: 'tools/call',
      params: { name: request.name, arguments: request.arguments ?? {} },
    })),
  ];
  const initOnly = all.slice(0, 2);
  for (const request of initOnly) {
    input.write(`${JSON.stringify(request)}\n`);
  }
  // 等 initialize 完成再发工具调用（握手前置）
  await waitFor(() => responses.has(0), 10_000);
  for (const request of all.slice(2)) {
    input.write(`${JSON.stringify(request)}\n`);
  }
  await waitFor(
    () => requests.every((_, index) => responses.has(index + 1)),
    90_000,
  );
  input.end();
  await Promise.race([pending, sleep(2000)]);
  await child.kill();
  return responses;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await sleep(100);
  }
}

function textOf(response: RpcResponse | undefined): string {
  return response?.result?.content?.[0]?.text ?? '';
}

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'fleet-test',
  GIT_AUTHOR_EMAIL: 'test@fleet.local',
  GIT_COMMITTER_NAME: 'fleet-test',
  GIT_COMMITTER_EMAIL: 'test@fleet.local',
};

let repo: string;

function git(cmd: string): string {
  return execSync(`git ${cmd}`, {
    cwd: repo,
    env: { ...process.env, ...GIT_ENV },
  }).toString();
}

const MISSION_YAML = `
id: mcp-demo
goal: MCP 全工作流
planningMode: execution
requirements:
  - text: 需求
plan:
  summary: 方案
tasks:
  - id: build
    goal: build
    agentRole: reason
    dependsOn: []
acceptance:
  - given: 无
    when: 执行
    then: 完成
`;

beforeAll(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'fleet-m12-e2e-'));
  git('init -q -b main');
  writeFileSync(path.join(repo, '.gitignore'), '.fleet/\n');
  writeFileSync(path.join(repo, 'base.txt'), 'baseline\n');
  writeFileSync(
    path.join(repo, 'sample.ts'),
    'export function targetFunc(): number {\n  return 42;\n}\n',
  );
  git('add -A');
  git('commit -qm baseline');
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('M12 e2e：MCP 两服务（独立客户端进程）', () => {
  it('SC-001 握手 + tools/list：repo 7 工具 / fleet 5 工具', async () => {
    for (const [server, expected] of [
      ['repo', 7],
      ['fleet', 5],
    ] as const) {
      const listChild = execa(process.execPath, [bin, 'mcp', server], {
        cwd: repo,
        reject: false,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'ignore',
      });
      const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };
      const list = { jsonrpc: '2.0', id: 2, method: 'tools/list' };
      const pending = collectJson(listChild);
      listChild.stdin!.write(`${JSON.stringify(init)}\n`);
      await waitFor(() => pending().has(1), 15_000);
      listChild.stdin!.write(`${JSON.stringify(list)}\n`);
      await waitFor(() => pending().has(2), 15_000);
      const responses = pending();
      expect(responses.get(1)?.result?.protocolVersion).toBe('2024-11-05');
      expect(responses.get(2)?.result?.tools).toHaveLength(expected);
      // 收尾不 await kill（vitest 环境下 kill 等待偶发悬挂——SIGKILL 兜底）
      listChild.stdin!.end();
      void listChild.kill('SIGKILL');
      await sleep(200);
    }
  }, 60_000);

  it('SC-002 repo 七工具矩阵（夹具仓库 + CodeGraph 降级不失败）', async () => {
    const responses = await withClient('repo', repo, [
      { name: 'repo_overview', arguments: {} },
      {
        name: 'repo_investigate',
        arguments: { question: 'targetFunc 在哪定义' },
      },
      { name: 'repo_symbol', arguments: { name: 'targetFunc' } },
      { name: 'repo_impact', arguments: { symbol: 'targetFunc' } },
      {
        name: 'repo_verify',
        arguments: { filePath: 'sample.ts', symbol: 'targetFunc' },
      },
      { name: 'wiki_query', arguments: { question: 'core' } },
      { name: 'wiki_read', arguments: { pagePath: '../escape.md' } },
    ]);
    // overview：结构化 JSON（codegraph 健康 + 近变更）
    expect(textOf(responses.get(1))).toContain('codegraph');
    // investigate：回退链返回（CodeGraph 缺失 → 搜索路径仍出结果）
    const investigateText = textOf(responses.get(2));
    expect(investigateText.length).toBeGreaterThan(0);
    expect(responses.get(2)?.result?.isError).toBeFalsy();
    // symbol / impact：无 CodeGraph → 结构化降级（不失败，宪法 I）
    expect(textOf(responses.get(3))).toContain('degraded');
    expect(textOf(responses.get(4))).toContain('degraded');
    // verify：源码锚定路径
    expect(textOf(responses.get(5))).toContain('verified');
    // wiki_query：未建库 → 明确提示（不失败）
    expect(responses.get(6)?.result?.isError).toBeFalsy();
    // wiki_read 越界 → 工具级错误
    expect(responses.get(7)?.result?.isError).toBe(true);
    expect(textOf(responses.get(7))).toContain('path_forbidden');
  }, 120_000);

  it('SC-003 fleet 五工具全工作流：create → run → status → result → cancel', async () => {
    const bad = await withClient('fleet', repo, [
      {
        name: 'fleet_create_mission',
        arguments: { missionYaml: 'id: 坏的\n' },
      },
    ]);
    expect(bad.get(1)?.result?.isError).toBe(true);
    expect(textOf(bad.get(1))).toContain('mission_invalid');

    const created = await withClient('fleet', repo, [
      {
        name: 'fleet_create_mission',
        arguments: { missionYaml: MISSION_YAML },
      },
    ]);
    expect(textOf(created.get(1))).toContain('mcp-demo');
    expect(textOf(created.get(1))).toContain('.fleet/missions/mcp-demo.yaml');

    const ran = await withClient('fleet', repo, [
      {
        name: 'fleet_run',
        arguments: {
          missionPath: path.join(repo, '.fleet/missions/mcp-demo.yaml'),
        },
      },
    ]);
    expect(ran.get(1)?.result?.isError).toBeFalsy();
    expect(textOf(ran.get(1))).toContain('"runId"');

    const after = await withClient('fleet', repo, [
      { name: 'fleet_status', arguments: { missionId: 'mcp-demo' } },
      { name: 'fleet_result', arguments: { missionId: 'mcp-demo' } },
      { name: 'fleet_cancel', arguments: { missionId: 'mcp-demo' } },
    ]);
    expect(textOf(after.get(1))).toContain('build');
    const resultText = textOf(after.get(2));
    expect(resultText).toContain('"partial"'); // Review Package 聚合形态
    expect(textOf(after.get(3))).toContain('已终态'); // 幂等取消
  }, 120_000);

  it('SC-004 协议健壮性：坏 JSON / 未知方法 / 握手前调用——服务存活', async () => {
    const child = execa(process.execPath, [bin, 'mcp', 'fleet'], {
      cwd: repo,
      reject: false,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const responses = collectJson(child);
    child.stdin!.write('不是 JSON\n');
    child.stdin!.write('{"jsonrpc":"2.0","id":1,"method":"no/such"}\n');
    child.stdin!.write('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n'); // 握手前
    await waitFor(() => responses().has(1) && responses().has(2), 15_000);
    child.stdin!.write('{"jsonrpc":"2.0","id":0,"method":"initialize"}\n');
    await waitFor(() => responses().has(0), 15_000);
    child.stdin!.end();
    expect(responses().get(-1)?.error?.code).toBe(-32700); // id null → 特殊键
    expect(responses().get(1)?.error?.code).toBe(-32601);
    expect(responses().get(2)?.error?.code).toBe(-32602);
    expect(responses().get(0)?.result?.protocolVersion).toBe('2024-11-05'); // 存活
    child.stdin!.end();
    void child.kill('SIGKILL');
    await sleep(200);
  }, 60_000);
});

/** 收集子进程 stdout 的逐行 JSON 响应（id → response） */
function collectJson(
  child: execa.ExecaChildProcess,
): () => Map<number, RpcResponse> {
  const map = new Map<number, RpcResponse>();
  let buffer = '';
  child.stdout!.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length > 0) {
        try {
          const parsed = JSON.parse(line) as RpcResponse & {
            id: number | string | null;
          };
          if (parsed.id === null) {
            map.set(-1, parsed); // parse 错误等 null id
          } else if (parsed.id !== undefined) {
            map.set(Number(parsed.id), parsed);
          }
        } catch {
          // 忽略非 JSON
        }
      }
      newline = buffer.indexOf('\n');
    }
  });
  return () => map;
}

void fixtureRoot;
