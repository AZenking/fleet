# Contract: @fleet/mcp 公共 API + CLI 行为

**Spec**: [../spec.md](../spec.md) | **Data Model**: [../data-model.md](../data-model.md)

## 1. McpServer

```ts
interface McpOptions {
  name: string; version: string;
  tools: ToolDefinition[];
  // 测试注入（缺省 process.stdin/stdout）
  input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream;
}
class McpServer {
  constructor(options: McpOptions);
  start(): Promise<void>;   // resolve 于输入流结束（EOF）
  // 单请求处理（内部派发——测试可直接调）
  handle(request: unknown): Promise<JsonRpcResponse | undefined>;
}
```

**合同条款**：

1. **握手前置**：initialize 之前 tools/* → -32602。
2. **零崩溃**：任意坏输入 → 错误响应；handler 抛异常 → 工具级
   错误（不击穿循环）。
3. **顺序处理**：逐行读、逐个答（单客户端语义）。
4. **notifications 忽略**：无 id 的消息不产生响应。

## 2. 协议常量

protocolVersion = '2024-11-05'；错误码 {parse:-32700,
invalidRequest:-32600, methodNotFound:-32601, invalidParams:-32602}；
工具错误在 result 内（isError: true + content）。

## 3. 工具装配

```ts
// repo-tools.ts
function buildRepoTools(): ToolDefinition[];   // 7 个（见 data-model §4）
// fleet-tools.ts
function buildFleetTools(options?: { missionsDir?: string }): ToolDefinition[]; // 5 个
```

- repo_* 的 repoRoot 参数缺省 = process.cwd()。
- wiki_read 路径白名单：解析后必须位于 <repoRoot>/.fleet/wiki/ 内。
- fleet_create_mission 落盘 `.fleet/missions/<id>.yaml`（目录自动
  建；校验失败零副作用）。
- fleet_run / status / result / cancel 与 CLI run/observe 同源
  （runMissionFile / viewRun / summary / cancel 标记）。

## 4. CLI

| 命令 | 行为 |
|---|---|
| `fleet mcp repo [--repo <root>]` | 启动 Repository Intelligence MCP 服务（stdio） |
| `fleet mcp fleet [--repo <root>]` | 启动 Fleet MCP 服务（stdio） |

服务进程运行至 stdin EOF；stderr 留给运行时日志（协议不过 stderr）。

## 5. Codex Desktop 接入（docs/control-center.md 内样例）

```json
{
  "mcpServers": {
    "fleet-repo": { "command": "fleet", "args": ["mcp", "repo"] },
    "fleet": { "command": "fleet", "args": ["mcp", "fleet"] }
  }
}
```

## 6. Control Center 延期决策（docs/control-center.md）

依据（宪法 Non-Goals "Complex GUI" + roadmap "Runtime 稳定后实现"）
+ 十一面板数据映射矩阵 + 恢复条件（真实使用证明必要 → 立项）。
