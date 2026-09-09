<!--
Sync Impact Report
- Version change: 1.0.0 → 1.1.0
- Modified principles: II（角色体系 Terra/Sol/Luna → 认知五级
  Reflex/Focus/Reason/Insight/Wisdom；写入权限改为分层：Reason 唯一
  深度写者、Reflex 轻量写者）；III / IV / V 同步角色名与措辞
- Modified sections: Development Workflow（M8/M9 验收锚点同步改名）
- Added sections: none（Principle II 内新增认知五级定义与旧命名映射）
- Removed sections: none
- Bump rationale: MINOR — 角色扩容与权限细化，无原则删除或推翻
- Follow-up TODOs: none
-->

# Agent Fleet Constitution

## Core Principles

### I. Repository Truth Model（事实分层）

- Source + Config 是唯一 Static Ground Truth；Tests / Runtime 是唯一
  Behavioral Truth。
- LLM Wiki 与 CodeGraph 是加速器：正常时提升速度、结构理解与 Token
  效率；失效时只允许造成 Latency ↑ / Token ↑ / Cost ↑，MUST NOT 导致
  Fleet 不可用。
- 加速器不可用、结果模糊、索引过期或与 Source 冲突时，MUST 自动降级到
  Native Search → Source 回退链，调查 MUST NOT 因加速器故障直接失败。
- Agent 的关键结论 MUST 可追溯到 Evidence
  （wiki / codegraph / search / source / config / test / runtime）。

### II. System-Enforced Permissions & Isolation（权限与隔离由系统强制）

- 角色体系为认知五级：Reflex（快速分诊）、Focus（定位调查）、
  Reason（规划与深度实现）、Insight（验证取证）、Wisdom（审阅裁决）。
- Focus、Insight、Wisdom 为 READ ONLY；Reason 是唯一深度写入
  Workspace 的角色；Reflex 仅允许琐碎任务的轻量写入。
- 权限 MUST 由 Runtime / Workspace / Tool Policy 层强制；仅靠 Prompt
  约束视为违规。
- Reflex 与 Reason 的写入 MUST 限制在被分配的隔离 Git Worktree 内；
  Runtime 只接收被分配的 cwd，MUST NOT 感知 Workspace 全貌。
- Agent 之间 MUST 通过 Structured Artifact 交换结果；禁止自由聊天，
  禁止共享完整会话记录。
- 旧命名映射：Terra → Focus + Insight；Sol → Reason（规划）+
  Wisdom（审阅）；Luna → Reason（实现）。

### III. Independent Validation（独立验收，NON-NEGOTIABLE）

- 最终 Validation（diff / lint / typecheck / tests）MUST 由 Fleet 的
  Validation Runner 独立执行。
- Reason / Reflex（或任何实现者）自报"测试通过"MUST NOT 作为 Mission 验收证据。
- Review Loop 必须有固定上限（默认 maxReviewLoops = 2）；禁止无限重试
  与无限 Review。

### IV. Role / Runtime Decoupling

- Agent Role（Reflex / Focus / Reason / Insight / Wisdom）MUST NOT 绑定特定 Runtime、Provider
  或 Model。
- 所有真实运行时（Codex / Claude / Gemini / Pi…）MUST 通过
  RuntimeAdapter 接入；替换 Runtime MUST NOT 要求修改 Scheduler / Core。
- FakeRuntimeAdapter MUST 先于任何真实 Adapter 存在；CI 端到端测试以
  Fake 为准以保持确定性。

### V. Deterministic Kernel First（确定性内核优先）

- Fleet Kernel 第一版 MUST 使用 Rule-based Scheduler、Static DAG、
  固定 retry（默认 1）、固定并发（默认 3）、显式 Review Loop。
- Fleet 1.0 之前 MUST NOT 引入 LLM Scheduler、Dynamic DAG Replanning、
  Agent 自由协商。
- planningMode 语义 MUST 遵守：`execution` 模式下 Reason MUST NOT
  推翻 Codex Desktop 已确认的 Mission Plan；仅 `autonomous` 模式
  允许 Reason Planning。

### VI. Reuse Over Reimplementation（不重复实现已有工具）

- MUST NOT 重新实现 CodeGraph，MUST NOT 自研复杂 AST / Call Graph /
  Impact Engine。
- 第一版 Wiki MUST NOT 引入 Vector Database。
- 优先封装现成工具（ripgrep / git / CodeGraph / LSP）；自研仅当无
  现成方案可用。

## Architecture Constraints & Non-Goals

技术栈约束：

- TypeScript + Node.js 24 + pnpm workspace；构建 tsup；测试 Vitest；
  Schema 校验 Zod；子进程 execa。
- Monorepo 结构：`apps/`（cli、control-center）+ `packages/`（core、
  repository、mission、scheduler、runtime、agents、artifacts、context、
  workspace、budget、observability）。
- Fleet MUST NOT 依赖 Codex Desktop；Codex Desktop 是 Interaction
  Layer（需求讨论与最终 Review），不是 Fleet Runtime 的一部分。
- 对外能力以 MCP 暴露：Repository Intelligence
  （repo_overview / repo_investigate / repo_symbol / repo_impact /
  repo_verify / wiki_query / wiki_read）与 Fleet
  （fleet_create_mission / fleet_run / fleet_status / fleet_result /
  fleet_cancel）。

Fleet 1.0 前明确不做（Non-Goals）：

- Vector Database、Long-term Agent Memory、Agent Free Chat
- Dynamic DAG Replanning、Distributed Fleet、Kubernetes Runtime
- 20+ Agent Roles、Complex GUI、Marketplace、Remote Multi-machine
  Execution、Autonomous Architecture Override

以上能力只有在真实使用证明必要后才可进入后续 Roadmap。

## Development Workflow & Milestone Acceptance

- 每个 Milestone（M0–M12）MUST 有独立、可执行的验收标准；验收未通过
  MUST NOT 进入下一阶段。
- 里程碑验收锚点（节选）：M1 CodeGraph 故障仍可完成调查；M6 Fake Fleet
  完整运行；M8 多 Reason 并行不污染主 Workspace；M9 Validation 不依赖
  Reason / Reflex 自报结果；M11 Crash 后可恢复并 Resume。
- 新功能要求修改核心架构时，MUST 先通过 Guardrails 检查：是否当前
  Milestone 必要、是否已有现成工具、是否把加速器变成硬依赖、是否破坏
  Truth Model / 权限边界 / Runtime 解耦、是否可推迟到 Fleet 1.0 之后。
  无法 justify 的复杂度一律推迟。
- 结构化事件（mission / task / agent / validation / budget / review /
  fallback）MUST 全程记录；Run 状态 MUST 可恢复（crash recovery、
  orphan cleanup、resume）。

## Governance

- 本 Constitution 是 Agent Fleet 项目的最高治理文档，与
  `agent-fleet-architecture.md`（架构基线）、`agent-fleet-roadmap.md`
  （执行计划）冲突时以本文件为准；架构与路线的实质性变更 MUST 先修订
  本文件。
- 修订流程：提出修订 → 对照 Guardrails 评估影响 → 按语义化版本更新
  （原则删除或重定义为 MAJOR；新增原则或实质扩展为 MINOR；措辞澄清为
  PATCH）→ 更新 Last Amended 日期。
- 合规审查：每个 Milestone 验收时 MUST 对照 Core Principles 检查；
  代码审查 MUST 验证权限边界、Validation 独立性与降级能力未被破坏。
- 开发指导遵循 `agent-fleet-roadmap.md` 的阶段与里程碑定义。

**Version**: 1.1.0 | **Ratified**: 2026-09-09 | **Last Amended**: 2026-09-09
