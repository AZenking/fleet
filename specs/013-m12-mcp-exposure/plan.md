# Implementation Plan: M12 MCP + Codex Desktop + Control Center（对外暴露与交互层）

**Branch**: `013-m12-mcp-exposure` | **Date**: 2026-09-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/013-m12-mcp-exposure/spec.md`

## Summary

新增 `packages/mcp`（@fleet/mcp）：零依赖 MCP 协议最小面（stdio
JSON-RPC 2.0——initialize / tools/list / tools/call / notifications
忽略 / 标准错误码）+ ToolDefinition 注册表（单一事实源）。两个服务
装配：Repository Intelligence（repo_overview/investigate/symbol/
impact/verify + wiki_query/read——@fleet/repository 原语薄组合）与
Fleet（fleet_create_mission/run/status/result/cancel——M4 校验落盘 /
runMissionFile 全链 / M11 视图与标记通道 / Review Package 聚合）。
CLI 增 `fleet mcp repo` / `fleet mcp fleet` 入口；Control Center
延期决策 + 十一面板数据映射矩阵 + Codex Desktop 接入样例文档化。
e2e 以独立 node 客户端进程（spawn + stdio）驱动全工作流。

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 24（同基线）

**Primary Dependencies**: 零新增——@fleet/core / @fleet/mission /
@fleet/repository / @fleet/runtime（runMissionFile）/ 
@fleet/observability（视图与 cancel）/ @fleet/workspace（diff 读取）

**Storage**: 读 M11 `.fleet/runs/`（零新持久化）；mission 落盘到
`.fleet/missions/<id>.yaml`（create_mission 产物）

**Testing**: 单元（协议循环矩阵：握手/分发/错误码/坏 JSON 顺序处理）+
工具层（夹具仓库逐工具结构化断言 / 降级语义）+ e2e（独立客户端
进程全工作流 + 协议健壮性连续请求）

**Target Platform**: macOS 本地（stdio 子进程）

**Project Type**: monorepo 新增 packages/mcp + apps/cli 两命令 +
docs/control-center.md（延期决策）

**Performance Goals**: 工具调用直通既有能力（无额外层级开销）；
顺序请求处理（单客户端语义）

**Constraints**: 零第三方依赖（不引入 MCP SDK）；服务进程零崩溃；
Fleet 零 Codex Desktop 感知；M0–M11 全量回归绿

**Scale/Scope**: 12 工具；协议最小面；2 服务入口

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 宪法条款 | 评估 | 结果 |
|---|---|---|
| I. Repository Truth Model | repo_* 工具直通 M1–M3 能力（含回退链）——降级语义经 MCP 路径同源 | PASS |
| II. 权限与隔离 | fleet_run 经 runMissionFile 全链（worktree 隔离 / 权限矩阵不变） | PASS |
| III. Independent Validation | result 工具只读 M9 Artifact 事实——判定路径零改动 | PASS |
| IV. Role/Runtime 解耦 | MCP 是暴露层——不触角色/运行时接缝 | PASS |
| V. Deterministic Kernel First | 协议循环纯分发（无调度逻辑）；工具为既有确定性能力直通 | PASS |
| VI. Reuse Over Reimplementation | 12 工具全部薄组合既有原语；协议最小面手写（<SDK 引入） | PASS |
| Architecture Constraints 技术栈 | packages/mcp 对齐终局结构；"对外能力以 MCP 暴露"达成；零新增依赖 | PASS |
| Non-Goals（Fleet 1.0 前） | Control Center UI（Complex GUI）延期决策文档化——宪法条款直接引用 | PASS |

## Project Structure

### Documentation (this feature)

```text
specs/013-m12-mcp-exposure/
├── plan.md / research.md / data-model.md / quickstart.md
├── contracts/
│   └── mcp-api.md  # 协议循环 + 12 工具契约（schema/返回/错误）
└── tasks.md
docs/control-center.md  # 延期决策 + 十一面板数据映射 + 接入样例
```

### Source Code (repository root，M12 增量)

```text
packages/mcp/
├── src/
│   ├── index.ts           # 公共出口
│   ├── protocol.ts        # JSON-RPC 循环（readline 分帧 / 分发 / 错误码）
│   ├── types.ts           # ToolDefinition / ToolResult / McpOptions
│   ├── server.ts          # McpServer（注册表 + 握手状态 + call 派发）
│   ├── repo-tools.ts      # 七工具装配（@fleet/repository 原语组合）
│   ├── fleet-tools.ts     # 五工具装配（mission/run/status/result/cancel）
│   └── *.test.ts          # 协议矩阵 + 工具层
├── package.json           # @fleet/mcp（core+mission+repository+runtime+observability）
└── tsconfig / tsup

apps/cli/src/commands/mcp.ts   # fleet mcp repo / fleet mcp fleet 入口
apps/cli/src/bin.ts            # 注册
docs/control-center.md         # US3 文档
tests/cli/mcp.test.ts          # e2e：独立客户端全工作流 + 健壮性
```

**Structure Decision**: 协议与工具分离（protocol/server 通用，工具
装配在 mcp 包内两文件）；CLI 仅入口（薄）。fleet_run 同步返回终态
（长任务经 status 轮询——roadmap 无流式要求）。

## Complexity Tracking

> 无宪法违规需要辩护，本表为空。

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
