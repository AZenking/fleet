# Feature Specification: M12 MCP + Codex Desktop + Control Center（对外暴露与交互层）

**Feature Branch**: `013-m12-mcp-exposure`

**Created**: 2026-09-12

**Status**: Draft

**Input**: User description: "继续" — 对应 `agent-fleet-roadmap.md`
Phase D / M12（最终里程碑）：Repository Intelligence MCP（repo_overview
/ repo_investigate / repo_symbol / repo_impact / repo_verify /
wiki_query / wiki_read）与 Fleet MCP（fleet_create_mission /
fleet_run / fleet_status / fleet_result / fleet_cancel）对外暴露；
Codex Desktop 工作流闭环（MissionSpec 进 → Fleet 执行 → Review
Package 出 → Final Review）；Control Center 消费事件流。宪法
Architecture Constraints 明文："对外能力以 MCP 暴露"；"Fleet
MUST NOT 依赖 Codex Desktop——Codex Desktop 是 Interaction
Layer"。宪法 Non-Goals：Complex GUI 是 Fleet 1.0 前明确不做项，
且 roadmap 对 Control Center 标注"Runtime 稳定后实现"。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Repository Intelligence MCP (Priority: P1)

作为 Codex Desktop（或任何 MCP 客户端）的使用者，我通过 MCP
工具调查仓库：`repo_overview`（仓库概览——wiki 状态 / CodeGraph
健康 / 近期变更）；`repo_investigate`（问题驱动的完整调查——
宪法 I 回退链全程生效）；`repo_symbol` / `repo_impact`（符号与
影响面直达查询）；`repo_verify`（源码锚定核验）；`wiki_query` /
`wiki_read`（wiki 检索与页面读取）。每个工具的返回是**结构化
内容**（JSON + 文本摘要），失败降级语义与 CLI 同源（加速器失效
只降级不失败）。

**Why this priority**: 宪法明文的对外暴露清单前半；Codex Desktop
高效理解大仓的入口；全部能力已在 M1–M3 交付——M12 只做暴露层。

**Independent Test**: 以 MCP 客户端协议（stdio）连接 Repository
Intelligence 服务：initialize 握手 → tools/list 列出七个工具 →
逐工具调用（sample 夹具仓库）断言结构化返回与降级语义。

**Acceptance Scenarios**:

1. **Given** MCP 客户端连接，**When** initialize，**Then** 握手
   成功（协议版本与能力声明）。
2. **Given** 握手完成，**When** tools/list，**Then** 恰好列出
   七个 Repository Intelligence 工具（名称 + 输入 schema + 描述）。
3. **Given** repo_investigate 调用（问题 + 仓库根），**When**
   执行，**Then** 返回调查结论（findings / references / 降级
   记录）——与 CLI `fleet repo investigate` 同源同义。
4. **Given** CodeGraph 不可用的仓库，**When** 任一依赖 CodeGraph
   的工具调用，**Then** 结构化降级返回（fallback 记录），不失败
   （宪法 I）。
5. **Given** wiki_query / wiki_read，**When** 调用，**Then** 返回
   检索结果 / 页面内容；wiki 未建时明确提示（可 init 的指引）。

---

### User Story 2 - Fleet MCP + Codex Desktop 工作流 (Priority: P2)

作为 Codex Desktop 的使用者，Fleet 的完整生命周期经 MCP 可用：
`fleet_create_mission`（MissionSpec 校验并落盘——Codex Desktop
确认的方案进入 Fleet 的正式契约）；`fleet_run`（执行——M9 验证门
+ M10 预算 + M11 落盘全部生效，返回 run 概要）；`fleet_status`
（任务级状态——M11 视图）；`fleet_result`（Review Package——M9
审阅汇总 + 预算 + diff，供 Final Review）；`fleet_cancel`（取消
——M11 标记通道）。工作流闭环：**Codex Desktop 讨论需求 →
fleet_create_mission（确认方案）→ fleet_run → fleet_result
（Review Package）→ Codex Desktop Final Review**——Fleet 全程
不感知 Codex Desktop（Interaction Layer 单向依赖）。

**Why this priority**: 宪法明文的后半清单 + "Codex Desktop →
Fleet → Codex Desktop" 验收锚点（roadmap M12）；这是 Fleet
承担真实软件工程任务的最后一公里。

**Independent Test**: MCP 客户端完成全工作流：create（校验失败
结构化拒绝）→ run（tmp git 仓库 + 替身运行时）→ status（running
→ 终态可查）→ result（Review Package 含验证门结论）→ cancel
（活跃 run 取消）；M9–M11 的全部语义经 MCP 路径回归。

**Acceptance Scenarios**:

1. **Given** 合法 MissionSpec，**When** fleet_create_mission，
   **Then** 校验通过并落盘（返回 mission 路径与摘要）；非法
   spec → 结构化拒绝（零副作用）。
2. **Given** 已创建 mission，**When** fleet_run，**Then** 执行
   全链（隔离 worktree / 验证门 / 预算 / 落盘），返回 run 概要
   （终态 / 任务表 / runId）。
3. **Given** 执行中或已终态 run，**When** fleet_status，**Then**
   任务级分布（completed/failed/skipped/interrupted/pending）。
4. **Given** 已终态 run，**When** fleet_result，**Then** Review
   Package（审阅终态与全轮次 / 预算汇总 / diff / 验证证据）。
5. **Given** 活跃 run，**When** fleet_cancel，**Then** 取消标记
   生效（M11 语义）；已终态 → 幂等提示。
6. **Given** 任一工具执行，**When** 发生，**Then** Fleet 侧零
   Codex Desktop 感知（无反向依赖——宪法边界）。

---

### User Story 3 - Control Center 数据面与延期决策 (Priority: P3)

作为 Control Center（规划中的桌面 UI）的未来消费者，其数据面
本期就绪：UI 所需的全部状态（Mission 列表 / DAG / Agent 状态 /
Live 日志 / Worktree / Artifact / Evidence / Token / Diff /
Validation / Review——roadmap 十一面板）**均可经 Fleet MCP 工具
与 `.fleet/runs/` 事件流获得**（M11 已落盘、M12 已暴露）；UI
本体（桌面应用）按宪法 Non-Goals（Complex GUI 属 Fleet 1.0 前
不做）与 roadmap "Runtime 稳定后实现" 条款**显式延期**——延期
决策、数据契约与消费路径写入文档，延期不是删除。

**Why this priority**: 宪法优先级排序——无法在 1.0 前 justify 的
复杂度一律推迟（Guardrails）；数据面就绪让延期零阻塞。

**Independent Test**: 数据面断言——十一面板所需信息逐项映射到
MCP 工具 / 事件类型 / 落盘文件（文档化矩阵 + 断言脚本：每个
面板字段在既有暴露面中可取）。

**Acceptance Scenarios**:

1. **Given** 一次完整 run 的落盘与 MCP 暴露面，**When** 对照
   roadmap 十一面板，**Then** 每面板的数据来源有明确映射
   （工具 / 事件 / 文件），无缺失项。
2. **Given** 延期决策，**When** 查阅文档，**Then** 决策依据
   （宪法 Non-Goals + roadmap 条款）、数据契约、恢复条件
   （真实使用证明必要后立项）齐备。
3. **Given** MCP 服务进程，**When** Codex Desktop 配置接入，
   **Then** 两服务（Repository Intelligence / Fleet）以命令行
   启动、stdio 通信（标准 MCP 接入形态，零特殊配置）。

---

### Edge Cases

- MCP 客户端发送未知方法 → 标准 JSON-RPC 错误（-32601），服务
  不崩溃。
- 工具参数缺失/类型错误 → 结构化工具级错误（含 schema 指引），
  非 协议层崩溃。
- fleet_run 对不存在 mission → 工具级错误；对校验失败 mission
  → 结构化拒绝（与 create 同义）。
- 并发调用（多客户端/多工具同时）→ Fleet 侧 run 串行语义
  （同一 mission 的 run 互不覆盖——M11 runId 隔离兜底）；MCP
  层不做并发承诺（单进程 stdio 顺序处理）。
- repo_* 工具对非 git 仓库 → 明确错误（与 CLI 同义）。
- wiki_read 对不存在页面 → 明确 not found；路径越界（../）→
  拒绝（安全边界）。
- fleet_result 对进行中 run → 返回当前状态 + 已有部分（不伪造
  终局）。
- initialize 之前调用工具 → 协议错误（握手前置）。
- 大返回（investigate 全量 references）→ 截断保护 + 标注
  （与 CLI 输出限制同义）。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Fleet MUST 提供两个 MCP 服务（Repository
  Intelligence / Fleet），以命令行启动、stdio 通信、标准 MCP
  协议（initialize / tools/list / tools/call；JSON-RPC 2.0）。
- **FR-002**: Repository Intelligence 服务 MUST 暴露七个工具：
  repo_overview / repo_investigate / repo_symbol / repo_impact /
  repo_verify / wiki_query / wiki_read——全部为既有能力的暴露
  （零核心逻辑重实现，宪法 VI），输入 schema 与结构化返回。
- **FR-003**: Fleet 服务 MUST 暴露五个工具：fleet_create_mission
  （校验 + 落盘）/ fleet_run（全链执行 + run 概要）/ fleet_status
  （M11 视图）/ fleet_result（Review Package 聚合）/ fleet_cancel
  （M11 标记通道）。
- **FR-004**: 工具失败 MUST 结构化返回（工具级错误对象 + 指引），
  服务进程零崩溃；协议层错误（未知方法 / 握手前调用）按
  JSON-RPC 标准。
- **FR-005**: 降级语义 MUST 与 CLI 同源：加速器失效只降级不失败
  （repo_* 返回 fallback 记录）；Fleet 工具的失败语义与对应 CLI
  一致。
- **FR-006**: fleet_result MUST 返回 Review Package 聚合：M9
  审阅终态与全轮次 + M10 预算汇总 + diff 引用 + 验证证据引用
  （自 M11 落盘读取，进行中 run 返回当前态不伪造）。
- **FR-007**: MCP 协议实现 MUST 零新增第三方依赖（最小协议面
  手写：initialize/tools/list/tools/call + 错误码——不引入
  SDK；宪法技术栈纪律）。
- **FR-008**: Control Center 延期决策 MUST 文档化：宪法 Non-Goals
  引用 + roadmap 条款 + 十一面板数据映射矩阵 + 恢复条件。
- **FR-009**: Codex Desktop 接入路径 MUST 文档化（两服务的命令
  行配置样例）；Fleet 代码零 Codex Desktop 依赖（宪法边界，
  依赖方向单向）。
- **FR-010**: 服务 MUST 可被任意标准 MCP 客户端消费——e2e 以
  独立客户端进程驱动（spawn + stdio JSON-RPC），非内部函数调用。

### Key Entities

- **McpServer**: stdio JSON-RPC 循环（请求分发 / 错误映射 /
  顺序处理）；两实例（repo / fleet）。
- **ToolDefinition**: name / description / inputSchema /
  handler——工具注册表（单一事实源，tools/list 与 call 同源）。
- **ToolResult**: 结构化内容（JSON payload + 文本摘要）或工具级
  错误（code + message + 指引）。
- **ReviewPackageView**: fleet_result 的聚合返回形态（M11 落盘
  的序列化视图）。
- **ControlCenterDataMap**: 十一面板 →（MCP 工具 / 事件类型 /
  落盘文件）映射矩阵（文档实体）。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 标准 MCP 客户端（独立进程）对两服务完成握手 +
  tools/list：恰 7 + 5 工具，schema 齐备。
- **SC-002**: Repository Intelligence 七工具逐个调用（sample
  夹具仓库）返回结构化结果；CodeGraph 不可用场景降级不失败
  （宪法 I 经 MCP 路径成立）。
- **SC-003**: Fleet 五工具全工作流 e2e：create（合法+非法）→
  run（tmp git 仓库 + 替身）→ status → result（Review Package
  完整）→ cancel；M9–M11 语义经 MCP 路径全数回归。
- **SC-004**: 协议健壮性：未知方法 / 坏 JSON / 握手前调用 /
  工具参数错误 → 标准错误响应，服务进程存活（连续请求不崩溃）。
- **SC-005**: 十一面板数据映射矩阵 100% 有源（每面板至少一条
  获取路径）；延期决策文档齐备（依据/契约/恢复条件）。
- **SC-006**: 零新增第三方依赖；全量既有测试回归绿（M0–M11
  零破坏）。

## Assumptions

- 落位 `packages/mcp`（@fleet/mcp：协议循环 + 工具注册表）+
  `apps/cli` 的 `fleet mcp repo` / `fleet mcp fleet` 两命令
  （服务入口）。
- MCP 协议最小面：JSON-RPC 2.0 over stdio（LSP 风格分行 JSON）；
  initialize / tools/list / tools/call / notifications 忽略——
  不追求全协议（prompt/resource 等能力不声明）。
- repo_symbol / repo_impact / repo_verify / repo_overview 为
  既有原语的薄组合（CodeGraph adapter 方法 + verifyAnchor +
  wiki 状态 + git 元信息）——查询语义与 M1–M3 定义一致。
- fleet_run 为同步执行返回终态概要（长任务的异步进度经
  fleet_status 轮询——MCP 工具不流式；roadmap 无流式要求）。
- Codex Desktop 接入 = 用户在其 MCP 配置中登记两命令（文档
  样例）；Fleet 不读取/不感知其配置。
- Control Center UI（Tauri 或其他）延期：宪法 Non-Goals 明文
  "Complex GUI" + roadmap "Runtime 稳定后实现"——数据面（本
  里程碑）就绪后按真实使用诉求立项。
- e2e 用 node 子进程作标准 MCP 客户端（spawn + stdin/stdout
  JSON-RPC）——不引入 SDK（零依赖同时保证"任意标准客户端可
  消费"的可测性）。
- 无新持久化（全部读 M11 `.fleet/runs/` 与内存执行）。
