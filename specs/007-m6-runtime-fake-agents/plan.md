# Implementation Plan: M6 RuntimeAdapter + Fake Agents（运行时契约与 Fake 执行端到端）

**Branch**: `007-m6-runtime-fake-agents` | **Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/007-m6-runtime-fake-agents/spec.md`

## Summary

新增 `packages/runtime` 包：RuntimeAdapter 契约（execute + cancel，
RuntimeRequest/Result）+ FakeRuntimeAdapter（五角色延迟画像、脚本化
成败/异常/hang、timeout 诚实与 cancel 先到先得的单次 settle、清理
完备）+ 桥接层（TaskExecutor→RuntimeAdapter 的 runId/agentId/
prompt/timeoutMs 生成规则集中一处）+ runMissionFile 编排（M4 校验 →
M5 DAG/调度 → Fake → RunReport）。CLI 交付 `fleet run <path>`。
M4 Run/TaskRun 实体首次实例化；事件三枚走 stderr。零新增依赖。

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 24（同 M0 基线）

**Primary Dependencies**: 零新增——`@fleet/mission`（Task/Run/TaskRun
schema 与校验）、`@fleet/scheduler`（TaskExecutor 端口/buildDag/
Scheduler）、`@fleet/core`（ids/events/RealFileSystem）

**Storage**: 无落盘（Run 持久化属 M11）——报告输出到 stdout/--json

**Testing**: Vitest——单元（fake 行为矩阵/桥接规则/runner 编排）、
e2e（tests/cli/run.test.ts：demo 端到端 + 失败 mission + 进程干净
退出）；全部走 Fake（宪法 IV，CI 确定性）

**Target Platform**: macOS 本地（同 M0–M5）

**Project Type**: monorepo 新增 packages/runtime 包 + CLI 命令

**Performance Goals**: demo mission 全程 < 1s（Fake 画像毫秒级）；
cancel settle < 剩余延迟（SC-004）；run 后进程干净退出（无悬挂
计时器，SC-005）

**Constraints**: timeout 诚实（迟到成功丢弃）与 cancel 单次 settle
（先到先得）；桥接规则集中一处；仅注册 Fake（FR-010）；零延迟
模式供 CI

**Scale/Scope**: 单 mission 单进程；必测六项矩阵全覆盖（FR-011）

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 宪法条款 | 评估 | 结果 |
|---|---|---|
| I. Repository Truth Model | N/A（不消费加速器） | PASS |
| II. 权限与隔离 | Fake 模拟执行、无真实文件操作；权限强制归 M7/M8（spec Assumption 划界） | PASS |
| III. Independent Validation | N/A（Fake 无自报验收语义；M9 落地） | PASS |
| IV. Role/Runtime 解耦 | FakeRuntimeAdapter 先于真实 Adapter；TaskExecutor 端口→RuntimeAdapter 的桥接是唯一转换点；e2e 以 Fake 为准 | PASS |
| V. Deterministic Kernel First | 调度/桥接全确定性；Fake 画像与脚本可复现（零延迟模式）；无 LLM | PASS |
| VI. Reuse Over Reimplementation | 复用 M4 校验/schema、M5 调度器/端口、core 事件/ID；零新增依赖 | PASS |
| Architecture Constraints 技术栈 | 包结构对齐既有模板（packages/runtime 对应 roadmap 最终结构） | PASS |
| Non-Goals（Fleet 1.0 前） | 未触碰（无真实 Runtime 提前接入 / 无分布式） | PASS |

## Project Structure

### Documentation (this feature)

```text
specs/007-m6-runtime-fake-agents/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── runtime-adapter.md  # RuntimeAdapter 契约 + Fake 行为矩阵语义
│   └── cli.md           # fleet run 命令契约
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root，M6 增量)

```text
packages/runtime/
├── src/
│   ├── index.ts         # 公共出口
│   ├── types.ts         # RuntimeRequest / RuntimeResult / 失败码 / RuntimeAdapter 契约 / FakeStep
│   ├── fake.ts          # FakeRuntimeAdapter（角色延迟画像 + 脚本化 + inflight 表 + 单次 settle + cleanup）
│   ├── bridge.ts        # MissionRuntimeBridge：TaskExecutor 适配（runId/agentId/prompt/timeoutMs 规则 + 任务时间戳记录）
│   └── runner.ts        # runMissionFile 编排（M4 校验 → M5 DAG/调度 → Fake → RunReport + 事件三枚）
├── package.json         # @fleet/runtime（依赖 mission + scheduler + core）
├── tsconfig.json / tsup.config.ts
└── src/*.test.ts        # fake 矩阵 / bridge 规则 / runner 编排（单元）

apps/cli/src/commands/run.ts            # fleet run 注册（薄壳：runner + 渲染 + 退出码）
tests/cli/run.test.ts                   # e2e：demo 端到端 / 失败 mission / autonomous / 进程干净退出
```

**Structure Decision**: roadmap 最终结构 `packages/runtime` 独立包；
编排函数（runMissionFile）在 runtime 包内可测（CLI 保持薄壳——
与 doctor/repo 命令同模式）；scheduler/mission 包零改动（单向
消费）。

## Complexity Tracking

> 无宪法违规需要辩护，本表为空。

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
