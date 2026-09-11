# Data Model: M12 MCP + Codex Desktop + Control Center

**Date**: 2026-09-12 | **Spec**: [spec.md](../spec.md)

## 1. ToolDefinition

| 字段 | 类型 | 规则 |
|---|---|---|
| `name` | string | 命名空间.动作（repo_* / wiki_* / fleet_*） |
| `description` | string | 一句话语义（tools/list 展示） |
| `inputSchema` | `{type:'object', properties, required?}` | JSON Schema 子集 |
| `handler` | `(args: Record<string, unknown>) => Promise<ToolResult>` | 同表派发 |

## 2. ToolResult

```ts
type ToolResult =
  | { ok: true; content: Array<{ type: 'text'; text: string }>; payload?: unknown }
  | { ok: false; code: string; message: string; hint?: string };
```

工具级错误进 JSON-RPC result（isError 语义），服务不崩；payload
供程序化消费（结构化 JSON 随文本附给客户端）。

## 3. 协议面（JSON-RPC 2.0 over stdio）

| 方法 | 行为 |
|---|---|
| `initialize` | 返回 {protocolVersion:'2024-11-05', capabilities:{tools:{}}, serverInfo} |
| `tools/list` | 注册表全量（name/description/inputSchema） |
| `tools/call` | `{name, arguments}` → handler → result / 工具错误 |
| notifications（无 id） | 静默忽略（initialized/cancelled 等） |
| 未知方法 | -32601 |
| 坏 JSON / 握手前 tools.* | -32700 / -32602 |

每行一 JSON（LSP 风格分帧）；顺序处理（读一行处理一行）。

## 4. 十二工具契约摘要

| 工具 | 入参（required） | 返回要点 |
|---|---|---|
| repo_overview | repoRoot | wiki 状态 + codegraph 健康 + 近变更 |
| repo_investigate | question, repoRoot | findings/references/fallbacks（全链） |
| repo_symbol | name, repoRoot | SymbolHit[]（降级结构化） |
| repo_impact | symbol, repoRoot | ImpactReport（降级结构化） |
| repo_verify | filePath, anchor, repoRoot | 锚定核验结果 |
| wiki_query | question, repoRoot | 命中页与摘要 |
| wiki_read | pagePath, repoRoot | 页面文本（路径白名单校验） |
| fleet_create_mission | missionYaml | 校验+落盘（.fleet/missions/<id>.yaml） |
| fleet_run | missionPath | 终态概要（runId/status/taskRuns/reviews 摘要） |
| fleet_status | missionId | 任务分布 + run 元信息 |
| fleet_result | missionId | ReviewPackageView（审阅/预算/diff/验证） |
| fleet_cancel | missionId | 取消标记（幂等语义） |

## 5. ReviewPackageView（fleet_result 聚合）

`{ runDir, status, tasks[], reviews[]（M9 全轮次）, budget（M10
汇总）, diffExcerpt（引用 + 头部摘录）, validation[]（M9 落盘） }`
——自 M11 `.fleet/runs/` 读取；进行中 run 返回当前态（标注
partial=true，不伪造终局）。

## 6. ControlCenterDataMap（docs/control-center.md）

十一面板（Mission List / DAG Visualization / Agent Status / Live
Logs / Worktree Status / Artifact Viewer / Evidence Viewer / Token
Usage / Diff Viewer / Validation Results / Review Status）×
三来源（MCP 工具 / 事件类型 / 落盘文件）矩阵——每面板 ≥1 条路径。
