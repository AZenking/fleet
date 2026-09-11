# Implementation Plan: M10 Context Builder + Token Budget（角色化上下文与 Token 预算）

**Branch**: `011-m10-context-budget` | **Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/011-m10-context-budget/spec.md`

## Summary

新增 `packages/context`（ContextBuilder：五角色声明式 section
规则 + DAG 上游产物注入 + 规则压缩阶梯 + 优化收益统计）与
`packages/budget`（UsageRecord 记录 + Agent/Task/Mission 三级聚合
+ BudgetLedger）：AgentTaskExecutor 的手写 prompt 模板替换为
Context 包确定性渲染（保留 `[任务 <id>]` 标记——替身 CLI 解析
兼容）；RuntimeResult 增可选 usage（Fake 脚本化注入 / CLI 尽力
解析 / 缺失标 measured=false）；M9 AgentReviewer 上下文迁移至
ContextBuilder（wisdom 规则，构成不缺项）；mission/task 级
maxTokens 约束接入压缩阶梯（超 → 压 2 轮 → Reject/Escalate 终态）。
RunReport 增 budget（三级聚合 + 优化收益汇总）。零新增依赖。

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 24（同基线）

**Primary Dependencies**: 零新增——`@fleet/core`、`@fleet/mission`
（Task/DAG 依赖 + maxTokens 约束）、`@fleet/runtime`
（RuntimeRequest/RuntimeResult 扩展）、`@fleet/agents`
（AgentTaskExecutor 接缝）、`@fleet/validation`（wisdom 规则的
validation artifact 来源）、`@fleet/workspace`（diff 来源）

**Storage**: 无持久化（run 内内存 Artifact 注册表 + BudgetLedger；
`.fleet/runs/` 落盘属 M11）

**Testing**: 单元（角色规则矩阵 / 压缩阶梯 / 聚合算术 / 估算口径）
+ 集成（executor 接缝：context 渲染进 prompt、usage 回收进 ledger）
+ e2e（fake usage 注入 → fleet run --json 断言 budget 三级聚合 +
contextSize + 优化统计；M9 全套回归保持绿）

**Target Platform**: macOS 本地（同基线）

**Project Type**: monorepo 新增 packages/context + packages/budget
+ agents/runtime/validation/cli 四处向后兼容扩展

**Performance Goals**: 装配毫秒级（纯字符串/规则）；压缩确定性
可复现；估算口径全链一致（可独立复算）

**Constraints**: 零 LLM 参与压缩；全量倾倒结构性排除（类型层）；
替身 CLI 的 `[任务 <id>]` prompt 标记兼容；测量缺失不伪造

**Scale/Scope**: 五角色规则 × DAG 注入矩阵；三级聚合；压缩两轮
上限；usage 六字段

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 宪法条款 | 评估 | 结果 |
|---|---|---|
| I. Repository Truth Model | context 的 source/config/diff/validation section 均携带来源引用，可追溯 Evidence | PASS |
| II. 权限与隔离 | 装配不改权限链路（请求仍经 policy env）；diff/validation section 只读注入 | PASS |
| III. Independent Validation | 审阅上下文迁移不改判定独立性（M9 e2e 回归守护，SC-006） | PASS |
| IV. Role/Runtime 解耦 | 装配按角色规则、usage 经 RuntimeResult 通用字段——不绑定运行时；Fake 注入保 CI 确定性 | PASS |
| V. Deterministic Kernel First | 装配与压缩全规则化（零 LLM）、确定可复现；Reject 终态不重试（沿用 M9 retryable 语义） | PASS |
| VI. Reuse Over Reimplementation | 不引入 tokenizer（字符系数估算）；复用 M4 maxTokens 约束与 M9 artifact/gate 既有结构 | PASS |
| Architecture Constraints 技术栈 | packages/context + packages/budget 对齐 roadmap 最终结构；零新增依赖 | PASS |
| Non-Goals（Fleet 1.0 前） | 未触碰（Context Cache / LLM 压缩 / 持久化 / 分布式均不做） | PASS |

## Project Structure

### Documentation (this feature)

```text
specs/011-m10-context-budget/
├── plan.md / research.md / data-model.md / quickstart.md
├── contracts/
│   └── context-budget-api.md  # Builder/Ledger 契约 + 角色规则表 + 阶梯语义
└── tasks.md
```

### Source Code (repository root，M10 增量)

```text
packages/context/
├── src/
│   ├── index.ts           # 公共出口
│   ├── types.ts           # ContextSection/ContextPackage/规则表/压缩配置
│   ├── registry.ts        # RunArtifactRegistry（taskId → 上游产物，内存）
│   ├── builder.ts         # ContextBuilder（角色规则装配 + DAG 注入）
│   ├── compress.ts        # 规则压缩阶梯 + Reject/Escalate 载体
│   ├── render.ts          # ContextPackage → 确定性 prompt 文本（[任务 <id>] 兼容）
│   └── *.test.ts
├── package.json           # @fleet/context（core+mission+runtime）
└── tsconfig / tsup

packages/budget/
├── src/
│   ├── index.ts
│   ├── types.ts           # UsageRecord/BudgetSummary/BudgetRejection
│   ├── estimate.ts        # 字符→token 估算口径 + 单价表（缺省 0）
│   ├── ledger.ts          # BudgetLedger（记录/三级聚合/卫生钳制）
│   └── *.test.ts
├── package.json           # @fleet/budget（core+mission）
└── tsconfig / tsup

packages/runtime/src/types.ts       # RuntimeResult 增可选 usage
packages/runtime/src/fake.ts        # FakeStep 增 usage 注入（确定性）
packages/agents/src/executor.ts    # prompt ← render(context)；执行后 registry 记产物 + ledger 记 usage
packages/validation/src/review.ts   # AgentReviewer 上下文 ← ContextBuilder（wisdom 规则）
packages/runtime/src/runner.ts      # RunReport 增 budget（duck-typing）
apps/cli/src/commands/run.ts        # 装配接线 + budget 渲染行
tests/cli/budget.test.ts            # e2e：三级聚合 / contextSize / 优化统计 / M9 回归
```

**Structure Decision**: 装配（context）与测量（budget）分属两个
roadmap 终局包；context 不依赖 budget（估算口径放 budget，
context 的 section 尺寸经共享的纯函数——放 budget.estimate，
context 依赖 budget）。数据流：executor 装配（context）→ 渲染 →
执行 → usage/产物回收（registry + ledger）→ 报告合成（runner
duck-typing，同 M8/M9 模式）。

## Complexity Tracking

> 无宪法违规需要辩护，本表为空。

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
