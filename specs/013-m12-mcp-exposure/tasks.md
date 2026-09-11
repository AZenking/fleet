# Tasks: M12 MCP + Codex Desktop + Control Center（对外暴露与交互层）

**Input**: Design documents from `/specs/013-m12-mcp-exposure/`

**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/ ✅ quickstart.md ✅

**Tests**: 包含测试任务——SC-001 握手与清单 / SC-002 七工具矩阵 /
SC-003 五工具全工作流 / SC-004 协议健壮性 / SC-005 数据面矩阵 /
SC-006 全量回归。

## Format: `[ID] [P?] [Story] Description`（路径相对仓库根）

---

## Phase 1: Setup

- [x] T001 初始化 `packages/mcp`（@fleet/mcp：core + mission + repository + runtime + observability）：package.json / tsconfig / tsup / 空 index；vitest.config.ts 增 `mcp` project

---

## Phase 2: Foundational

- [x] T002 `packages/mcp/src/{types,protocol,server}.ts`：ToolDefinition/ToolResult 类型 + JSON-RPC 循环（readline 分帧 / initialize / tools/list / tools/call / notifications 忽略 / -32700/-32600/-32601/-32602 / handler 异常→工具级错误）+ 单测（协议矩阵：握手前置 / 坏 JSON / 未知方法 / 顺序处理 / EOF 退出——注入流驱动）

**⚠️ CRITICAL**: T002 完成前不得开始工具装配

---

## Phase 3: US1 Repository Intelligence 七工具

- [x] T003 [US1] `packages/mcp/src/repo-tools.ts`：七工具装配（repo_overview=wiki status+health+recentChangedFiles 聚合 / repo_investigate=investigate 全链 / repo_symbol=adapter.symbol / repo_impact=adapter.impact / repo_verify=verifyAnchor / wiki_query=queryWiki / wiki_read=loadWikiPages+路径白名单）+ 工具层单测（夹具仓库：结构化返回 / CodeGraph 缺失降级不失败 / wiki_read 越界拒绝）
- [x] T004 [US1] `apps/cli/src/commands/mcp.ts` + bin.ts 注册：`fleet mcp repo`（stdio 服务，--repo 可选）；smoke：`printf ...initialize... | fleet mcp repo` 出协议响应

---

## Phase 4: US2 Fleet 五工具 + 工作流

- [x] T005 [US2] `packages/mcp/src/fleet-tools.ts`：五工具（fleet_create_mission=内存校验+落盘 .fleet/missions/<id>.yaml（非法零副作用）/ fleet_run=runMissionFile（runPersistence 落盘接缝同 CLI）/ fleet_status=latestRunDir+viewRun+summary / fleet_result=ReviewPackageView 聚合（summary+validation+usage+diff 头部摘录；进行中标注 partial）/ fleet_cancel=RunStore.requestCancel）+ 单元（create 双路径 / result 聚合形态 / cancel 幂等）
- [x] T006 [US2] `fleet mcp fleet` 命令（同 T004 模式）+ e2e `tests/cli/mcp.test.ts`：独立 node 客户端（spawn+stdin/stdout 行协议）——① 握手+两服务 tools/list（7+5，SC-001）；② repo 七工具矩阵（夹具仓库 + 降级路径，SC-002）；③ fleet 全工作流（tmp git 仓库：create→run（Fake+验证门替身？——MCP fleet_run 缺省 Fake，validation gate 默认开→用 mission validation commands 内联 echo）→status→result（含 budget/reviews 字段断言）→cancel 幂等，SC-003）；④ 协议健壮性连续请求存活（SC-004）

---

## Phase 5: US3 数据面与延期决策 + Polish

- [x] T007 [US3] `docs/control-center.md`：延期决策（宪法 Non-Goals + roadmap 条款引用）+ 十一面板 × 三来源映射矩阵（Mission List=fleet_status+ps / DAG=mission.json tasks+events / Agent Status=events task.* / Live Logs=logs 命令+events.jsonl / Worktree=clean --orphans 扫描面 / Artifact=validation.json / Evidence=repo_investigate / Token=usage.json+budget / Diff=diff.patch+fleet diff / Validation=validation.* 事件 / Review=reviews）+ Codex Desktop 接入样例 + 恢复条件
- [x] T008 [P] 全量回归：lint/format/build/test 零失败（M0–M11 零破坏 = SC-006）；README 仓库结构 + M12 规格链接 + MCP 命令；quickstart 走查；提交 milestone commit

---

## Dependencies & Execution Order

T001 → T002 → T003/T005（可并行）→ T004/T006 → T007/T008

## Implementation Strategy

MVP = 协议循环 + repo 七工具 → fleet 五工具 + e2e → 文档收束

## Notes

- e2e 客户端必须独立进程（FR-010——防内部调用假绿）
- fleet_run 与 CLI run 共用 runMissionFile——一切 M9-M11 语义自动同源
