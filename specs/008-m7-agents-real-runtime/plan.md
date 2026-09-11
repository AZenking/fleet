# Implementation Plan: M7 五角色 Agent + 真实 Runtime（认知角色落地与权限强制）

**Branch**: `008-m7-agents-real-runtime` | **Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/008-m7-agents-real-runtime/spec.md`

## Summary

新增 `packages/agents`（五角色定义 + 权限矩阵单一来源 + 运行时
注册表 + 角色解析执行器）与 `packages/runtime` 的 CLI 适配器基座
（探测 / 子进程执行 / 进程组 kill / 输出截断 / 裸请求拒绝）及
Codex / Gemini / Pi 三个薄适配器。`fleet run` 增运行时选择
（`--runtime`，缺省 Fake，显式不可用即报错不静默降级）。本机
实测：pi 0.85.1 已装（`-p --mode text --append-system-prompt
--no-session` 非交互面干净），codex/gemini 未装——真实 e2e
按探测跳过，全矩阵由受控 PATH 替身脚本保证。零新增依赖。

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 24（同基线）

**Primary Dependencies**: 零新增——execa（子进程）、core
（probe/fs/ids/events）、@fleet/mission（AgentRole）、
@fleet/scheduler（TaskExecutor 端口）、@fleet/runtime（契约与
Fake）；外部 CLI：pi（本机 0.85.1）、codex/gemini（未装，参数
按替身脚本开发 + 探测校准）

**Storage**: 无新持久化（Run 落盘 M11；请求流记录在内存报告 /
stderr 事件）

**Testing**: 单元（替身脚本驱动 CliRuntimeAdapter 全矩阵 + 权限
断言 + 注册表）+ e2e（Fake 基线不变 + pi 真实端到端按探测启用/
跳过）+ 走查（本机 pi 跑 demo mission）

**Target Platform**: macOS 本地（进程组 kill 用 detached + 负
PID，darwin/linux 语义）

**Project Type**: monorepo 新增 packages/agents + runtime 包扩展
+ CLI 选项

**Performance Goals**: 适配器无额外层开销（子进程即全部）；
timeout/cancel 的 kill 到 settle < 100ms；输出截断上限 64KB

**Constraints**: M6 契约四条款在真实进程复测；权限请求级必达 +
裸请求拒绝；物理隔离不做（M8，FR-010）；不静默降级 Fake

**Scale/Scope**: 单机子进程运行时；三真实适配器 + Fake

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 宪法条款 | 评估 | 结果 |
|---|---|---|
| I. Repository Truth Model | N/A（不消费仓库加速器） | PASS |
| II. 权限与隔离 | 权限矩阵单一来源（agents/policy）+ 请求必带 + 裸请求拒绝 + 适配器翻译；物理 Worktree 显式划界 M8（FR-010） | PASS |
| III. Independent Validation | N/A（M9 落地验证独立性） | PASS |
| IV. Role/Runtime 解耦 | 注册表 = role→adapter 配置行为；替换零改 Scheduler/bridge/mission；Fake 仍为 e2e 基线 | PASS |
| V. Deterministic Kernel First | 调度语义不变；注册 / 权限 / 探测全确定性规则 | PASS |
| VI. Reuse Over Reimplementation | 子进程 / 探测复用 execa + core probe；三适配器共享 CliRuntimeAdapter 基座（只差命令配置） | PASS |
| Architecture Constraints 技术栈 | 新包对齐模板；零新增依赖 | PASS |
| Non-Goals（Fleet 1.0 前） | 未触碰（无 Agent 自由聊天 / 无自主架构推翻） | PASS |

## Project Structure

### Documentation (this feature)

```text
specs/008-m7-agents-real-runtime/
├── plan.md / research.md / data-model.md / quickstart.md
├── contracts/
│   ├── agents-policy.md    # 角色定义 + 权限矩阵 + 注册表契约
│   └── cli.md              # fleet run --runtime 契约
└── tasks.md
```

### Source Code (repository root，M7 增量)

```text
packages/agents/
├── src/
│   ├── index.ts
│   ├── definitions.ts      # 五角色定义（职责提示片段/权限/输出形态提示）
│   ├── policy.ts           # 权限矩阵单一来源 + assertRequestPermission（裸请求拒绝）
│   ├── registry.ts         # RuntimeRegistry（role→adapter；未注册报错；多对一合法）
│   └── executor.ts         # AgentTaskExecutor（per-task 角色解析 + 权限注入 + 请求构造 + 记录）
├── package.json            # @fleet/agents（依赖 mission + scheduler + runtime + core）
└── tsconfig / tsup

packages/runtime/src/
├── cli-adapter.ts          # CliRuntimeAdapter 基座：探测/子进程/进程组 kill/截断/无 stdin/裸请求拒绝
├── codex.ts / gemini.ts / pi.ts   # 薄适配器（命令名 + 参数模板，pi 按本机实测）
└── availability.ts         # RuntimeAvailability 探测（doctor 同源）

apps/cli/src/commands/run.ts        # --runtime 解析（name 或 role=name，可重复，缺省 fake）
packages/runtime/src/runner.ts      # executor 注入点（默认保持 M6 bridge 行为）

tests/fixtures/fake-clis/           # 替身脚本：ok/fail/slow（pid 文件）/big-output/child-spawner
tests/cli/runtime-adapters.test.ts  # 替身矩阵 + 权限/注册 e2e（受控 PATH）
```

**Structure Decision**: roadmap 最终结构 agents（角色）与 runtime
（运行时）分包，依赖单向 agents→runtime；执行器（AgentTaskExecutor）
是 M6 bridge 的角色化进化版——M6 bridge 保留为默认快路径，runner
新增 executor 注入点（向后兼容）。

## Complexity Tracking

> 无宪法违规需要辩护，本表为空。

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
