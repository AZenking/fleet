# Control Center：延期决策与数据面契约

**状态**：数据面就绪（M12）· UI 本体延期 | **决策日期**：2026-09-12

## 决策

Tauri Control Center（桌面 UI）**延期至真实使用证明必要后立项**。
本里程碑（M12）交付其全部数据面——延期不阻塞、不删除。

## 依据

1. **宪法 Non-Goals（Fleet 1.0 前明确不做）**：`agent-fleet-architecture.md`
   与宪法列明 "Complex GUI" 属 1.0 前非目标。
2. **roadmap 条款**：M12 对 Control Center 标注 "Runtime 稳定后实现"
   ——M9–M11 Runtime 刚稳定（验证门 / 预算 / 恢复全绿），按
   Guardrails（"无法 justify 的复杂度一律推迟"）先让数据面与 MCP
   暴露经受真实使用。
3. **可测性**：桌面 GUI 无法纳入本仓 Vitest 体系验收；数据面
   （MCP 工具 + 事件流 + 落盘）全部可自动化断言。

## 十一面板数据映射矩阵（每面板 ≥1 条获取路径）

| 面板               | MCP 工具                                      | 事件类型                                               | 落盘文件                            |
| ------------------ | --------------------------------------------- | ------------------------------------------------------ | ----------------------------------- |
| Mission List       | `fleet_status`（逐 mission）                  | `mission.created/started/*`                            | `.fleet/runs/*/*/mission.json`      |
| DAG Visualization  | —（mission 静态 DAG）                         | —                                                      | `mission.json`（tasks + dependsOn） |
| Agent Status       | `fleet_status`                                | `task.started/completed/failed/skipped`                | `events.jsonl`                      |
| Live Logs          | —（CLI `fleet logs`）                         | 全事件流                                               | `events.jsonl`（JSONL tail）        |
| Worktree Status    | —（CLI `fleet ps --orphans` / `fleet clean`） | `workspace.created/destroyed`                          | git worktree list                   |
| Artifact Viewer    | `fleet_result`                                | `validation.*`                                         | `validation.json`                   |
| Evidence Viewer    | `repo_investigate` / `repo_verify`            | `evidence.conflict`                                    | 调查返回（findings/references）     |
| Token Usage        | `fleet_result`（budget）                      | `budget.warning/exceeded`                              | `usage.json`                        |
| Diff Viewer        | `fleet_result`（diffExcerpt）                 | `workspace.*`                                          | `diff.patch`                        |
| Validation Results | `fleet_result`                                | `validation.started/completed`                         | `validation.json`                   |
| Review Status      | `fleet_status` / `fleet_result`               | `review.requested/approved/changes-requested/exceeded` | `validation.json`（ReviewPackage）  |

## Codex Desktop 接入样例

两服务以命令行启动、stdio 通信（标准 MCP 接入形态）：

```json
{
  "mcpServers": {
    "fleet-repo": { "command": "fleet", "args": ["mcp", "repo"] },
    "fleet": { "command": "fleet", "args": ["mcp", "fleet"] }
  }
}
```

工作流（roadmap M12）：Codex Desktop 讨论需求 → `fleet_create_mission`
（确认方案）→ `fleet_run` → `fleet_result`（Review Package）→ Final
Review。Fleet 全程不感知 Codex Desktop（Interaction Layer 单向依赖，
宪法边界）。

## 恢复条件

- 真实使用中 MCP 工具 + CLI 观测面证明不足（具体痛点记录在案）
- 届时立项：UI 仅消费本矩阵的数据面（Event Stream + MCP 工具 +
  `.fleet/runs/`），不直接耦合 Scheduler 内部实现（roadmap 条款）
