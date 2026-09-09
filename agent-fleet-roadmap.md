# Agent Fleet --- Full Roadmap

> Status: Architecture Baseline\
> Scope: Repository Intelligence + Fleet Runtime + Agent Runtime +
> Validation + Codex Desktop Integration\
> Goal: 实现一个可降级、可验证、可观测、支持多 Agent 并行执行的软件工程
> Agent Runtime。

## 1. 产品定位

Agent Fleet 不替代 Codex Desktop。

-   **Codex Desktop**：多轮需求讨论、架构推演、计划制定、最终 Review。
-   **Repository Intelligence**：帮助 Codex / Agent 高效理解大型
    Repository，减少重复读取源码和 Token 消耗。
-   **Fleet Runtime**：把已经明确的 Mission 组织成 DAG，并调度
    Reflex / Focus / Reason / Insight / Wisdom 完成实现、验证和 Review。

``` text
YOU
 ↓
Codex Desktop
 Requirement / Discussion / Planning
 ↓
Repository Intelligence
 Wiki + CodeGraph + Fallback + Evidence
 ↓
Mission
 ↓
Fleet Runtime
 DAG / Scheduler / Artifact / Context / Workspace
 ↓
Reflex / Focus / Reason / Insight / Wisdom
 ↓
Validation
 ↓
Wisdom Internal Review
 ↓
Review Package
 ↓
Codex Desktop
 Final Review
 ↓
YOU
```

## 2. 核心架构原则

### 2.1 Repository Truth Model

``` text
LLM Wiki                  Knowledge Accelerator
   ↓
CodeGraph                 Structural Accelerator
   ↓
Native Search
   ↓
Source + Config           Static Ground Truth
   ↓
Compiler / Type System
   ↓
Tests / Runtime           Behavioral Truth
```

必须遵守：

1.  Wiki accelerates understanding.
2.  CodeGraph accelerates investigation.
3.  Source + Config establish static ground truth.
4.  Tests / Runtime establish behavioral correctness.
5.  Wiki 和 CodeGraph 都不是 Fleet 的硬依赖。
6.  Repository Intelligence 工具失败时必须允许降级。

CodeGraph 正常时提高速度、结构理解和 Token 效率；CodeGraph
不可用、结果模糊、索引过期或结果可疑时，自动回退到 Native Search +
Source。

### 2.2 Agent 权限

  Agent   职责                                                  Workspace Write
  ------- ----------------------------------------------------- -----------------
  Reflex  快速分诊、琐碎任务直处理                              ✅ 轻量
  Focus   Repository 定位调查、证据收集                         ❌
  Reason  Execution Planning、深度 Implementation、Fix          ✅ 深写
  Insight 验证取证、影响分析、Evidence 汇总                     ❌
  Wisdom  Internal Review、裁决                                 ❌

硬规则：

-   Focus / Insight / Wisdom 不修改代码。
-   Reason 是唯一深度写入 Workspace 的 Agent。
-   Reflex 仅允许琐碎任务的轻量写入，且同样限制在被分配的 Worktree。
-   命名映射（历史）：Terra → Focus + Insight；Sol → Reason（规划）+
    Wisdom（审阅）；Luna → Reason（实现）。
-   Agent 之间不进行自由聊天。
-   Agent 之间通过 Structured Artifact 交换结果。
-   权限必须由 Runtime / Workspace / Tool Policy 强制，而不能只依赖
    Prompt。

### 2.3 Role / Runtime 解耦

``` text
Reflex  ─┐
Focus   ─┤
Reason  ─┼→ RuntimeAdapter → Codex / Gemini / Pi / OpenCode / ...
Insight ─┤
Wisdom  ─┘
```

Agent Role 不绑定 Runtime、Provider 或 Model。

------------------------------------------------------------------------

# 3. Roadmap Overview

``` text
PHASE A — Repository Intelligence

M0  Foundation
 ↓
M1  CodeGraph + Fallback
 ↓
M2  LLM Wiki
 ↓
M3  Evidence System
 ↓
★ Repository Intelligence 0.1


PHASE B — Fleet Kernel

M4  Core Domain
 ↓
M5  Task DAG + Scheduler
 ↓
M6  RuntimeAdapter + Fake Agents
 ↓
★ Fleet Kernel


PHASE C — Agent Execution

M7  Reflex / Focus / Reason / Insight / Wisdom
 ↓
M8  Workspace + Git Worktree
 ↓
M9  Validation + Review Loop
 ↓
M10 Context Builder + Token Budget
 ↓
★ Fleet 1.0


PHASE D — Production

M11 Observability + Recovery
 ↓
M12 MCP + Codex Desktop + Control Center
 ↓
★ Complete Agent Fleet
```

# 4. Phase A --- Repository Intelligence

目标：在 Fleet Runtime 尚未完成之前，就让 Codex Desktop 能高效理解大型
Repository。

## M0 --- Foundation

### 目标

建立 Agent Fleet Monorepo 和基础工程能力。

### 技术栈

-   TypeScript
-   Node.js 24
-   pnpm workspace
-   tsup
-   Vitest
-   Zod
-   execa
-   yaml

### 基础目录

``` text
agent-fleet/
├── apps/
│   └── cli/
├── packages/
│   ├── core/
│   ├── repository/
│   ├── mission/
│   ├── scheduler/
│   ├── runtime/
│   ├── agents/
│   ├── artifacts/
│   ├── context/
│   ├── workspace/
│   ├── budget/
│   └── observability/
├── configs/
├── missions/
├── tests/
└── .fleet/
```

### 基础能力

-   Config Loader
-   Zod Schema
-   Error Model
-   Logger Interface
-   Event Interface
-   ID Generator
-   Filesystem abstraction
-   Git repository detection

### CLI

``` bash
fleet doctor
```

检查 Node、Git、Repository、CodeGraph availability、Runtime
availability、Fleet configuration。

### 验收

``` bash
pnpm test
fleet doctor
```

------------------------------------------------------------------------

## M1 --- CodeGraph + Fallback

### 目标

建立 Repository Investigation 的第一条完整链路。

### 原则

**不要重新实现 CodeGraph。Fleet 只提供 Adapter。**

``` text
packages/repository/
├── codegraph/
│   ├── adapter.ts
│   ├── health.ts
│   └── types.ts
├── fallback/
│   ├── search.ts
│   ├── source.ts
│   └── git.ts
└── investigation/
    └── policy.ts
```

CodeGraph Adapter 封装实际安装版本支持的 search / explore / symbol /
callers / callees / impact / health 等能力。

### Fallback

``` text
CodeGraph
   ↓
Result Valid?
   ├─ YES → Return
   └─ NO
       ↓
Native Search
rg / git / find
       ↓
Source Read
```

### Fallback Trigger

至少覆盖：

-   CodeGraph unavailable / timeout / MCP error
-   stale index / parser error
-   symbol missing / ambiguous symbol
-   unexpected empty result
-   unsupported language
-   dynamic invocation / reflection / DI
-   framework magic
-   generated code
-   config-driven behavior
-   CodeGraph 与 Source 冲突

### 故障测试

主动模拟关闭 CodeGraph、破坏 index、stale index、不存在 symbol、同名
symbol、timeout。

### CLI

``` bash
fleet repo investigate "AuthService login flow"
```

### 验收

CodeGraph 故障时自动 `Search → Source → Result`，调查不能因 CodeGraph
不可用直接失败。

------------------------------------------------------------------------

## M2 --- LLM Wiki

### 目标

建立 Repository Persistent Knowledge Layer。

### 原则

第一版不引入 Vector Database，使用 Markdown + index.md + 文件导航 +
ripgrep/全文搜索。

### Wiki Structure

``` text
.fleet/wiki/
├── index.md
├── architecture/
│   ├── overview.md
│   ├── backend.md
│   ├── frontend.md
│   └── data-flow.md
├── domains/
├── infrastructure/
├── decisions/
└── glossary.md
```

### Components

-   Wiki Generator
-   Wiki Reader
-   Wiki Index
-   Wiki Validator
-   Wiki Updater

### Metadata

``` yaml
---
generated_from: <git-sha>
updated_at: <timestamp>
scope:
  - apps/api/auth
  - packages/auth
---
```

### Incremental Update

``` text
Git Diff
 ↓
Changed Files
 ↓
Affected Modules / Symbols
 ↓
Affected Wiki Pages
 ↓
Incremental Update
```

### CLI

``` bash
fleet wiki init
fleet wiki build
fleet wiki status
fleet wiki update
fleet wiki query "认证系统怎么工作？"
```

### 验收

Wiki 可初始化、导航、增量更新和识别 stale；Wiki 不存在时 Repository
Investigation 仍可工作。

------------------------------------------------------------------------

## M3 --- Evidence System

### 目标

让 Agent 不只输出结论，还输出证据来源。

``` ts
type EvidenceSource =
  | "wiki"
  | "codegraph"
  | "search"
  | "source"
  | "config"
  | "lsp"
  | "compiler"
  | "test"
  | "runtime";

interface Finding {
  statement: string;
  evidence: Evidence[];
  confidence: "high" | "medium" | "low";
  conflicts?: EvidenceConflict[];
}
```

### Components

-   Evidence Resolver
-   Confidence Policy
-   Conflict Resolver
-   Fallback Trigger
-   Investigation Mode

### FAST

``` text
Wiki / CodeGraph
 ↓
Evidence
```

### VERIFY

``` text
Wiki / CodeGraph
 ↓
Native Search
 ↓
Source + Config
 ↓
Evidence
```

删除 Service、公共 API、DB Schema、Authentication、Payment、大范围
Refactor 等高风险判断默认升级 VERIFY。

### 验收

每个关键 Finding 可追踪到 Wiki / CodeGraph / Source / Config / Test 等
Evidence。

------------------------------------------------------------------------

# 5. Release Gate --- Repository Intelligence 0.1

``` text
Codex Desktop
      ↕
Repository Intelligence
├── LLM Wiki
├── CodeGraph
├── Fallback
└── Evidence
      ↕
Repository
```

建议暴露 MCP：

``` text
repo_overview
repo_investigate
repo_symbol
repo_impact
repo_verify
wiki_query
wiki_read
```

此时即可在日常 Codex Desktop Planning 中使用。

# 6. Phase B --- Fleet Kernel

目标：建立不依赖真实 LLM 的可靠 Fleet 执行内核。

## M4 --- Core Domain

实现： - Mission - Task - Artifact - Run

``` ts
interface Mission {
  id: string;
  goal: string;
  plan?: Plan;
  requirements: Requirement[];
  constraints: Constraint[];
  acceptance: AcceptanceCriteria[];
  planningMode: "autonomous" | "execution";
}
```

### Planning Mode

-   `autonomous`：只有 Requirement，允许 Reason Planning。
-   `execution`：Codex Desktop 已确认方案，Reason 负责执行拆解，不擅自推翻
    Mission Plan。

### CLI

``` bash
fleet mission validate ./missions/demo.yaml
```

### 验收

Schema / Constraint / Acceptance / planningMode 验证完整，错误信息清晰。

------------------------------------------------------------------------

## M5 --- Task DAG + Scheduler

### DAG

支持 dependency validation、cycle detection、missing/self
dependency、ready task selection、completion、failure propagation。

必须测试： - linear - parallel - diamond - cycle - missing dependency -
self dependency - failure

### Scheduler

第一版使用确定性的 Rule-based Scheduler，不使用 LLM Scheduler。

``` text
Ready Tasks
 ↓
Concurrency Check
 ↓
Dispatch
 ↓
Result
 ↓
Update DAG
```

默认：

``` text
maxConcurrency = 3
retry = 1
```

### 验收

无依赖的任务能够真实并发。

------------------------------------------------------------------------

## M6 --- RuntimeAdapter + Fake Agents

### Runtime Contract

``` ts
interface RuntimeAdapter {
  execute(request: RuntimeRequest): Promise<RuntimeResult>;
  cancel(runId: string): Promise<void>;
}
```

``` ts
interface RuntimeRequest {
  runId: string;
  agentId: string;
  cwd: string;
  prompt: string;
  env?: Record<string, string>;
  timeoutMs: number;
}
```

### Fake Runtime

先实现 FakeRuntimeAdapter，模拟 Reflex / Focus / Reason / Insight / Wisdom 延迟、成功和失败。

### 必测

-   timeout
-   cancel
-   failure
-   retry
-   concurrency
-   process cleanup

### 验收

``` bash
fleet run ./missions/demo.yaml
```

能够完成
`Mission → DAG → Fake Reflex / Focus / Reason / Insight / Wisdom → Complete`。

# 7. Release Gate --- Fleet Kernel

M4--M6 完成后，Fleet 调度系统已经成立，即使没有真实 AI Provider。

# 8. Phase C --- Agent Execution

## M7 --- Reflex / Focus / Reason / Insight / Wisdom + Real Runtime

实现： - ReflexAgent - FocusAgent - ReasonAgent - InsightAgent -
WisdomAgent - CodexAdapter - GeminiAdapter - PiAdapter - Future Runtime
Adapters

权限必须在 Runtime / Tool Policy 层强制：

``` text
Reflex  → WRITE (轻量·仅琐碎任务)
Focus   → READ ONLY
Reason  → WRITE (唯一深度写者)
Insight → READ ONLY
Wisdom  → READ ONLY
```

### 验收

同一 Agent Role 可以替换 Runtime 而无需修改 Scheduler/Core。

------------------------------------------------------------------------

## M8 --- Workspace + Git Worktree

``` ts
interface WorkspaceManager {
  create(taskId: string): Promise<Workspace>;
  getDiff(workspace: Workspace): Promise<string>;
  merge(workspace: Workspace): Promise<void>;
  destroy(workspace: Workspace): Promise<void>;
}
```

实现 GitWorktreeManager。

``` text
Task
 ↓
Create Worktree
 ↓
Reason
 ↓
Diff
 ↓
Validation
 ↓
Merge / Reject
 ↓
Destroy
```

支持多个 Reason：

``` text
Reason A → Worktree A
Reason B → Worktree B
Reason C → Worktree C
```

必须处理 merge conflict、dirty workspace、branch collision、process
crash、orphan worktree、cleanup failure。

### 验收

多个 Reason 并行执行时不能污染主 Workspace，也不能互相污染。

------------------------------------------------------------------------

## M9 --- Validation + Review Loop

### 原则

Reason / Reflex 可以开发过程中运行测试，但最终 Validation 必须由 Fleet 独立执行。

``` text
Reason Implementation
 ↓
Fleet Validation Runner
 ├─ Git Diff
 ├─ Lint
 ├─ Typecheck
 └─ Tests
 ↓
Validation Artifact
 ↓
Wisdom Internal Review
```

Review：

``` text
Approved
或
Changes Requested
 ↓
Reason Fix
 ↓
Validation
 ↓
Wisdom Review
```

默认：

``` text
maxReviewLoops = 2
```

### 验收

Reason / Reflex 自报"测试通过"不能作为 Mission Acceptance；只有 Validation Runner
结果可以作为验收证据。

------------------------------------------------------------------------

## M10 --- Context Builder + Token Budget

### Context Builder

Reflex：

``` text
Mission + Task Goal（最小上下文）
```

Focus：

``` text
Mission + Repository Intelligence + Task Goal
```

Reason：

``` text
Mission + Focus Findings + Insight Evidence + Relevant Source + Constraints
```

Insight：

``` text
Mission + Reason Diff + Validation 结果 + Source + Config
```

Wisdom：

``` text
Mission + Validation Artifact + Insight Findings + Diff
```

禁止把 Full Conversation + Full Repository + All Artifacts 塞给所有
Agent。

### Budget

支持 Mission / Task / Agent Budget。

记录： - inputTokens - outputTokens - cachedTokens - duration -
estimatedCost - contextSize

超预算：

``` text
Context Too Large
 ↓
Compress
 ↓
Retry
 ↓
Reject / Escalate
```

### 验收

能够按 Agent / Task / Mission 查看 Context 和 Token 消耗，并估算 Context
优化收益。

# 9. Release Gate --- Fleet 1.0

``` text
Codex Desktop
 ↓
Mission
 ↓
Fleet
 ↓
Focus
 ↓
Reason Planning
 ↓
Reason × N
 ↓
Worktrees
 ↓
Validation
 ↓
Wisdom Review
 ↓
Review Package
```

Fleet 已可承担真实软件工程任务。

# 10. Phase D --- Production

## M11 --- Observability + Recovery

### Events

包括： - mission.created / started / completed / failed - task.queued /
started / completed / failed - agent.started / completed / failed -
codegraph.fallback - wiki.stale - evidence.conflict - workspace.created
/ destroyed - validation.started / completed / failed - budget.warning /
exceeded - review.requested / approved

### Persistence

``` text
.fleet/runs/<mission-id>/
├── mission.json
├── events.jsonl
├── artifacts/
├── logs/
├── usage.json
├── diff.patch
├── validation.json
└── summary.json
```

### CLI

``` bash
fleet status <mission>
fleet logs <mission>
fleet inspect <mission>
fleet diff <mission>
fleet ps
fleet cancel <mission>
```

### Recovery

-   Crash Recovery
-   Run Resume
-   Orphan Process Cleanup
-   Orphan Worktree Cleanup
-   Partial Mission Recovery

### 验收

进程异常退出后不丢失 Run
状态，能识别已完成任务、清理孤儿资源并从合理位置 Resume。

------------------------------------------------------------------------

## M12 --- MCP + Codex Desktop + Control Center

### Repository Intelligence MCP

``` text
repo_overview
repo_investigate
repo_symbol
repo_impact
repo_verify
wiki_query
wiki_read
```

### Fleet MCP

``` text
fleet_create_mission
fleet_run
fleet_status
fleet_result
fleet_cancel
```

### Codex Desktop Workflow

``` text
YOU
 ↕
Codex Desktop
 ↕
Repository Intelligence MCP
 ↕
Repository
```

Planning 完成：

``` text
Codex Desktop
 ↓
MissionSpec
 ↓
Fleet
```

执行结束：

``` text
Fleet
 ↓
Review Package
 ↓
Codex Desktop
 ↓
Final Review
```

Fleet 不依赖 Codex Desktop；Codex Desktop 是 Interaction Layer。

### Tauri Control Center

Runtime 稳定后实现：

-   Mission List
-   DAG Visualization
-   Agent Status
-   Live Logs
-   Worktree Status
-   Artifact Viewer
-   Evidence Viewer
-   Token Usage
-   Diff Viewer
-   Validation Results
-   Review Status

UI 通过 Event Stream 消费 Fleet 状态，不直接耦合 Scheduler 内部实现。

# 11. Final Project Structure

``` text
agent-fleet/
├── apps/
│   ├── cli/
│   └── control-center/
├── packages/
│   ├── core/
│   ├── repository/
│   │   ├── wiki/
│   │   │   ├── generator/
│   │   │   ├── updater/
│   │   │   ├── index/
│   │   │   └── validator/
│   │   ├── codegraph/
│   │   │   └── adapter/
│   │   ├── fallback/
│   │   │   ├── search/
│   │   │   ├── source/
│   │   │   └── lsp/
│   │   ├── investigation/
│   │   └── evidence/
│   ├── mission/
│   ├── scheduler/
│   ├── artifacts/
│   ├── context/
│   ├── runtime/
│   ├── agents/
│   ├── workspace/
│   ├── validation/
│   ├── budget/
│   └── observability/
├── configs/
│   ├── agents/
│   └── fleet.yaml
├── missions/
├── tests/
└── .fleet/
    ├── wiki/
    ├── runs/
    ├── artifacts/
    ├── worktrees/
    ├── cache/
    └── logs/
```

# 12. Release Plan

  -----------------------------------------------------------------------
  Release                 Milestones              能力
  ----------------------- ----------------------- -----------------------
  Foundation              M0                      工程基础

  Repo Intelligence 0.1   M1--M3                  Wiki + CodeGraph +
                                                  Fallback + Evidence

  Fleet Kernel            M4--M6                  Mission + DAG +
                                                  Scheduler + Fake
                                                  Runtime

  Fleet 1.0               M7--M10                 Real Agents +
                                                  Worktree + Validation +
                                                  Context/Budget

  Fleet Production        M11                     Observability +
                                                  Recovery

  Complete Fleet          M12                     MCP + Codex Desktop +
                                                  Control Center
  -----------------------------------------------------------------------

# 13. Development Rules

## Rule 1 --- 每个 Milestone 必须独立验收

``` text
M1  → CodeGraph 挂掉仍然能调查代码
M2  → Codex 能通过 Wiki 理解 Repository
M3  → Investigation 有 Evidence
M5  → DAG 能真实并发
M6  → Fake Fleet 完整运行
M7  → Real Agent 完整运行
M8  → 多 Reason 并行不污染 Workspace
M9  → Validation 不依赖 Reason / Reflex 自报结果
M10 → Context / Token 可测量
M11 → Fleet Crash 后可恢复
M12 → Codex Desktop → Fleet → Codex Desktop
```

## Rule 2 --- 不重复实现已有工具

-   不重新实现 CodeGraph。
-   不为第一版 Wiki 引入 Vector DB。
-   不自己实现复杂 AST / Call Graph / Impact Engine。

## Rule 3 --- Accelerator 不得成为单点依赖

LLM Wiki、CodeGraph、Context Cache、LSP 失效只允许造成：

``` text
Latency ↑
Token ↑
Cost ↑
```

不能直接导致 Fleet unavailable。

## Rule 4 --- Fleet Kernel 优先确定性

第一版： - Rule-based Scheduler - Static DAG - Fixed retry - Fixed
concurrency - Explicit Review Loop

暂不做： - LLM Scheduler - Dynamic DAG - Agent 自由协商 - 无限重试 -
无限 Review

## Rule 5 --- 权限由系统强制

Focus/Insight/Wisdom READ ONLY，Reason 深度 WRITE，Reflex 轻量 WRITE，不能只依赖 Prompt。

# 14. Explicit Non-Goals Before Fleet 1.0

Fleet 1.0 前不做：

-   Vector Database
-   Long-term Agent Memory
-   Agent Free Chat
-   Dynamic DAG Replanning
-   Distributed Fleet
-   Kubernetes Runtime
-   20+ Agent Roles
-   Complex GUI
-   Marketplace
-   Remote Multi-machine Execution
-   Autonomous Architecture Override

这些能力只有真实使用证明必要后才进入后续 Roadmap。

# 15. Success Criteria

最终 Fleet 应满足：

-   大 Repository 不必每轮重新全文读取。
-   CodeGraph 错误/不可用时自动降级。
-   Wiki stale/不存在时系统仍可工作。
-   Agent 调查结论可以追踪 Evidence。
-   Focus / Insight / Wisdom 无法修改代码。
-   Reason / Reflex 写入仅限隔离 Worktree。
-   多 Reason 可以并行。
-   Validation 独立于 Reason / Reflex。
-   Agent Role 与 Runtime/Provider 解耦。
-   Context 可控制。
-   Token 可测量。
-   Mission 可追踪。
-   Run 可恢复。
-   最终实现可由 Codex Desktop 和人类 Review。

# 16. Roadmap Summary

``` text
M0  Foundation
 │
M1  CodeGraph + Fallback
 │
M2  LLM Wiki
 │
M3  Evidence System
 │
 ├── ★ Repository Intelligence 0.1
 │
M4  Core Domain
 │
M5  DAG + Scheduler
 │
M6  RuntimeAdapter + Fake Agents
 │
 ├── ★ Fleet Kernel
 │
M7  Reflex / Focus / Reason / Insight / Wisdom
 │
M8  Workspace + Git Worktree
 │
M9  Validation + Review Loop
 │
M10 Context Builder + Token Budget
 │
 ├── ★ Fleet 1.0
 │
M11 Observability + Recovery
 │
 ├── ★ Fleet Production
 │
M12 MCP + Codex Desktop + Control Center
 │
 ▼
★ Complete Agent Fleet
```

# 17. Architecture Baseline Guardrails

后续新功能要求修改核心架构时，先判断：

1.  是否属于当前 Milestone 的必要能力？
2.  是否已有现成工具可以承担？
3.  是否会让 Optional Accelerator 变成 Required Dependency？
4.  是否破坏 Source + Config Ground Truth 原则？
5.  是否破坏 Reflex / Focus / Reason / Insight / Wisdom 权限边界？
6.  是否破坏 Runtime / Provider 解耦？
7.  是否可以推迟到 Fleet 1.0 以后？

如果会增加不必要复杂度，应优先推迟，而不是立即扩展 Fleet Core。
