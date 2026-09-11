# Implementation Plan: M9 Validation + Review Loop（独立验收与审阅循环）

**Branch**: `010-m9-validation-review-loop` | **Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/010-m9-validation-review-loop/spec.md`

## Summary

新增 `packages/validation`：ValidationRunner（diff 走 M8
WorkspaceManager.getDiff + lint/typecheck/tests 走受控子进程，超时
与输出截断结构化）+ ValidationProfile 解析（mission 显式覆盖 →
package.json scripts 探测）+ AgentReviewer（Wisdom 经 RuntimeAdapter
执行、裁决 JSON 解析 fail-closed）+ ValidationReviewGate（显式循环
编排：验证 → 审阅 → 修复，maxReviewLoops 默认 2）。`fleet run`
验证门：M8 的 WorkspaceResolvingExecutor 增加可插拔 gate 接缝
（无 gate = M8 行为，向后兼容），merge 仅在验证通过 + 审阅批准后
发生；scheduler 的执行结果增加 `retryable: false` 终态信号（审阅
裁决是确定性结论，重试不改判——防止上限被 M5 retry 翻倍）。
mission schema 增加 `validation` 配置与 `maxReviewLoops`。零新增
依赖；e2e 全程 tmp git 仓库 + 替身 CLI。

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 24（同基线）

**Primary Dependencies**: 零新增——execa（检查命令子进程）、
`@fleet/core`（createId/FleetEvent 序列化）、`@fleet/mission`
（Mission/Task + schema 扩展）、`@fleet/runtime`
（RuntimeAdapter/RuntimeRequest 契约 + ROLE_PERMISSIONS）、
`@fleet/workspace`（WorkspaceManager.getDiff + gate 接缝）、
`@fleet/agents`（RuntimeRegistry——Wisdom 复用角色解析）

**Storage**: 无持久化（内存 Artifact + RunReport 字段；事件序列化
能力就绪，`.fleet/runs/` 落盘属 M11）

**Testing**: 单元（profile 解析 / runner 状态矩阵 / 裁决解析 /
gate 循环与上限——fake gate + fake manager 注入）+ 包级集成
（真 GitWorktreeManager 于 tmp 仓库 + Fake 双实例：实现者带
touchOnSuccess、审阅者带脚本化裁决）+ e2e（fleet run 二进制 +
tmp 仓库 + write-cli / review-cli / check 脚本替身，覆盖
SC-001 自报矛盾锚点、SC-003 三路径、SC-004 零 merge 断言）

**Target Platform**: macOS 本地（与 M8 相同的 git worktree 基座）

**Project Type**: monorepo 新增 packages/validation + workspace /
scheduler / mission / runtime / cli 五处向后兼容扩展

**Performance Goals**: 单检查命令默认超时 300s（mission 可覆盖）；
审阅执行默认预算 120s；输出摘要头尾各 2KB；fake 路径 CI 秒级

**Constraints**: Runner 不在实现者进程内执行、不读实现者输出
（宪法 III）；审阅错误 fail-closed（不放行）；验证门关闭 =
M8 auto、无 worktree = M7 直通（两级逃生口）；e2e 不触碰本仓
工作区

**Scale/Scope**: 四类检查 × 四种状态矩阵；maxReviewLoops 上限
强制；事件可重放；ReviewPackage 全轮次可查

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 宪法条款 | 评估 | 结果 |
|---|---|---|
| I. Repository Truth Model | Artifact 携带证据类型（test / runtime / config），验收结论可追溯 Evidence | PASS |
| II. 权限与隔离 | Runner 与 Reviewer 均不写主仓：验证在 worktree、Wisdom 只读（READ_ONLY + cwd=主仓根，M8 语义）；实现者与验证物理无关 | PASS |
| III. Independent Validation | **本里程碑核心落点**：独立 Runner + 自报不进判定路径 + maxReviewLoops 固定上限（默认 2）+ 无限循环结构性不可能 | PASS |
| IV. Role/Runtime 解耦 | Wisdom 审阅经 RuntimeAdapter（Fake 脚本化裁决驱动 CI；真实 CLI 同一契约）；裁决解析在 Fleet 侧，不绑定运行时 | PASS |
| V. Deterministic Kernel First | Review Loop 是显式任务级循环（DAG 不变、无 Replanning）；retryable:false 只收紧 M5 retry 对确定性结论的滥用，不引入动态行为 | PASS |
| VI. Reuse Over Reimplementation | diff 复用 M8 getDiff；检查命令复用仓库自身脚本（探测而非自带 linter）；事件/错误模型复用既有包 | PASS |
| Architecture Constraints 技术栈 | packages/validation 对齐 roadmap 最终结构；零新增依赖；无新 CLI 命令 | PASS |
| Non-Goals（Fleet 1.0 前） | 未触碰（事件持久化 / Run 恢复属 M11；MCP 暴露属 M12——ReviewPackage 仅随 RunReport 内存交付） | PASS |

## Project Structure

### Documentation (this feature)

```text
specs/010-m9-validation-review-loop/
├── plan.md / research.md / data-model.md / quickstart.md
├── contracts/
│   └── validation-api.md  # Runner/Reviewer/Gate 契约 + 裁决解析约定 + 事件类型
└── tasks.md
```

### Source Code (repository root，M9 增量)

```text
packages/validation/
├── src/
│   ├── index.ts           # 公共出口
│   ├── types.ts           # ValidationCheck/Artifact/Profile、ReviewVerdict/Package、事件类型
│   ├── profile.ts         # Profile 解析：mission.validation 覆盖 → package.json scripts 探测（pm 识别）
│   ├── runner.ts          # ValidationRunner：diff（manager.getDiff）+ lint/typecheck/tests（受控子进程）
│   ├── review.ts          # AgentReviewer：wisdom RuntimeRequest 构造 + 裁决解析（fail-closed）
│   ├── gate.ts            # ValidationReviewGate：循环编排 + 事件发射 + packages 收集
│   └── *.test.ts          # 单元（矩阵/解析/循环上限）
├── package.json           # @fleet/validation（core+mission+runtime+workspace+agents）
└── tsconfig / tsup

packages/workspace/src/types.ts     # + WorkspaceGate / GateEvaluation / GateDecision 端口
packages/workspace/src/executor.ts  # + gate 接缝与 reviews 代理（无 gate = M8 行为）
packages/scheduler/src/types.ts     # + TaskExecutor 结果 retryable?: boolean（默认 true）
packages/scheduler/src/scheduler.ts # + retryable === false → 终态 failed（不重入队）
packages/mission/src/types.ts       # + validation 配置 schema + maxReviewLoops（可选字段）
packages/runtime/src/runner.ts      # + RunReport.reviews（duck-typing 合成）
apps/cli/src/commands/run.ts        # + --no-validation-gate + gate 装配 + 报告渲染
tests/fixtures/fake-clis/review-approved-cli.sh / review-reject-cli.sh
tests/fixtures/checks/lint-pass.sh / lint-fail.sh / tests-fail.sh / hang.sh
tests/cli/validation.test.ts        # e2e：SC-001 自报矛盾 / SC-003 三路径 / SC-004 零 merge
```

**Structure Decision**: 判定逻辑独立成包（`@fleet/validation`），
生命周期留在 `@fleet/workspace`——workspace 只新增 `WorkspaceGate`
端口（评价 + 决策），validation 实现 gate 并拥有 Runner / Reviewer /
循环状态；`@fleet/scheduler` 仅扩展执行结果信号（`retryable`），
调度核心零改动。依赖方向 validation → workspace/agents/runtime/
mission/core，无环。

## Complexity Tracking

> 无宪法违规需要辩护，本表为空。

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
