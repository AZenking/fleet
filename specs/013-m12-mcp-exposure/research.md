# Research: M12 MCP + Codex Desktop + Control Center

**Date**: 2026-09-12 | **Status**: 技术决策已定

关键输入：@fleet/repository 原语面（CodeGraphAdapter 六方法 /
investigate / verifyAnchor / queryWiki / loadWikiPages / wiki status），
runMissionFile（RunnerOptions 全量接缝），M11 viewRun/summary/
cancel 标记，M9 RunReport.reviews，M4 validateMissionFile。

## D1 — 协议最小面手写（不引入 SDK）

- **Decision**: packages/mcp/protocol.ts——stdio JSON-RPC 2.0：
  readline 分帧（每行一 JSON）；方法集 {initialize, tools/list,
  tools/call}；notifications（无 id 请求）静默忽略；错误码 -32700
  （parse）/ -32600（invalid request）/ -32601（method not found）/
  -32602（invalid params，握手前调用亦归此）。
- **Rationale**: 宪法零依赖纪律；MCP 核心面即 JSON-RPC 三方法；
  Codex Desktop 等 clients 对 stdio server 只需这三方法 + 协议版本
  协商。
- **Alternatives considered**: @modelcontextprotocol/sdk（新依赖，
  违纪）；HTTP transport（roadmap 无要求，stdio 是桌面接入标准）。

## D2 — 工具注册表单一事实源

- **Decision**: ToolDefinition {name, description, inputSchema
  （JSON Schema 子集——type/properties/required）, handler(args) →
  ToolResult}；McpServer.tools/list 与 tools/call 同表派发——
  列表与行为零漂移。
- **Rationale**: schema 即文档（tools/list 输出直接可用）；新工具
  单点注册。
- **Alternatives considered**: 两处维护（漂移风险）。

## D3 — 七个 repo 工具的原语映射

- **Decision**: repo_symbol → adapter.symbol(name)；repo_impact →
  adapter.impact(symbol)（不可用 → 结构化降级含 fallback 提示）；
  repo_verify → verifyAnchor(filePath/anchor)（M1 源码锚定）；
  repo_overview → wiki status + adapter.health + recentChangedFiles
  聚合；repo_investigate → investigate(question) 全链；wiki_query →
  queryWiki；wiki_read → loadWikiPages + 路径白名单校验（仅
  .fleet/wiki/ 下、禁 ../——安全边界）后返回页面文本。
- **Rationale**: 全部薄组合（宪 VI）；降级语义与 CLI 同源（宪 I）。
- **Alternatives considered**: 每工具自带查询逻辑（重实现）。

## D4 — 五个 fleet 工具的接缝映射

- **Decision**: fleet_create_mission → validateMissionFile 内容校验
  （内存 YAML）→ 落盘 `.fleet/missions/<id>.yaml`；fleet_run →
  runMissionFile（cwd = 服务启动目录；runtime 缺省 Fake——真实
  runtime 经 mission/环境约定，与 CLI --runtime 同义的能力本期以
  默认配置暴露，旗标类运行时选择不进 MCP 面）；fleet_status →
  latestRunDir + viewRun + summary；fleet_result → summary +
  validation.json + usage.json + diff.patch 聚合（ReviewPackageView）；
  fleet_cancel → RunStore.requestCancel。
- **Rationale**: 全部既有接缝直通；MCP 面只暴露产品级动作（运行时
  选择属调用方环境配置，不是工具参数——避免把配置面泄进协议）。
- **Alternatives considered**: fleet_run 携 runtime 参数（协议面
  膨胀 + 配置泄漏）；异步任务句柄（roadmap 无流式要求）。

## D5 — fleet_run 的同步语义与超时

- **Decision**: 同步执行至终态返回概要（status/taskRuns/runId/
  reviews 终态摘要）；客户端超时自负（Codex Desktop 的 MCP 超时
  配置属其侧）。长任务最佳实践 = run（后台语义由客户端并发发起
  或后续轮询 status）。
- **Rationale**: 最小协议面；M11 落盘已保 crash 安全。
- **Alternatives considered**: 进度通知流（notifications/generated
  ——协议面扩大，1.0 后按需）。

## D6 — Control Center 延期决策文档

- **Decision**: docs/control-center.md——延期依据（宪法 Non-Goals
  "Complex GUI" + roadmap "Runtime 稳定后实现"）+ 十一面板 ×
  （MCP 工具 / 事件类型 / 落盘文件）映射矩阵 + Codex Desktop 接入
  样例（两命令行）+ 恢复条件（真实使用证明必要 → 立项）。
- **Rationale**: Guardrails 条款执行——无法 justify 的复杂度推迟，
  推迟不等于删除；数据面就绪使恢复零阻塞。
- **Alternatives considered**: 本期实现 Tauri UI（违 Non-Goals；
  且 GUI 无法在本仓测试体系内验收）。

## D7 — e2e 客户端形态

- **Decision**: tests/cli/mcp.test.ts——node 子进程 spawn
  `fleet mcp repo|fleet`，stdin 写 JSON-RPC 行、stdout 读行断言；
  复用一个极简客户端辅助（发送 + 收集 id 匹配响应）。
- **Rationale**: FR-010——标准客户端路径验证（防内部调用假绿）；
  零依赖（不用 SDK 写测试客户端）。
