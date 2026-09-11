# Implementation Plan: M5 Task DAG + Scheduler（任务图与确定性调度）

**Branch**: `006-m5-dag-scheduler` | **Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/006-m5-dag-scheduler/spec.md`

## Summary

新增 `packages/scheduler` 包：TaskDag（构建即校验——悬空/自环/
多节点环报环链，DFS 三色检测）+ 就绪选择（mission 声明序稳定
排序）+ 确定性调度循环（就绪 → 并发检查 → 并行派发 → 收结果 →
更新图，失败传播到不动点）+ 注入式 TaskExecutor 端口（M6
RuntimeAdapter 的适配目标）。固定语义：maxConcurrency=3、
retry=1、无 LLM、无动态重排（宪法 V）。零新增依赖；纯库交付
（无 CLI、无持久化）。

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 24（同 M0 基线）

**Primary Dependencies**: 零新增——`@fleet/mission`（Task 实体、
TaskRunStatus 枚举）+ `@fleet/core`（错误模型按需）；Zod（配置
校验，既有）

**Storage**: 无（Run 持久化属 M11；调度状态全部内存，run() 结束
返回 RunOutcome）

**Testing**: Vitest 单元层全覆盖（拓扑矩阵 7 类 + 并发时序 + 传播
链 + 确定性双跑）；ScriptedExecutor 脚本化假执行器（延迟/成功/
失败/抛异常可编程，记录调用序与并发峰值）；无 e2e（无 CLI）

**Target Platform**: macOS 本地（同 M0–M4）

**Project Type**: monorepo 新增 packages/scheduler 纯库包

**Performance Goals**: 真实并发量化——3×120ms 无依赖任务总耗时
< 300ms（串行基线 360ms，SC-002）；并发峰值 = min(就绪数,
maxConcurrency)（采样断言，比时序更稳）

**Constraints**: 确定性（同 DAG + 同执行器脚本 → 同派发序列，
SC-006）；running ≤ maxConcurrency 恒成立；异常不击穿循环；
固定 retry（默认 1）；无超时机制（M6 契约）

**Scale/Scope**: 单 mission 任务集（百级节点）；调度决策 O(V+E)
每轮

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 宪法条款 | 评估 | 结果 |
|---|---|---|
| I. Repository Truth Model | N/A（不消费加速器） | PASS |
| II. 权限与隔离 | 无 Agent 实体；执行器是端口，权限强制属 M7/M8 | PASS |
| III. Independent Validation | N/A（无实现型角色） | PASS |
| IV. Role/Runtime 解耦 | TaskExecutor 端口就是 Runtime 接缝——M6 RuntimeAdapter 适配，Scheduler 不感知具体运行时 | PASS |
| V. Deterministic Kernel First | Rule-based 调度、Static DAG、固定 retry=1 / 并发=3、显式失败传播；无 LLM / 动态重排 / 无限重试 | PASS |
| VI. Reuse Over Reimplementation | Task/状态枚举复用 M4；不重造 mission 校验（图级三查自含，Mission 级归 M4） | PASS |
| Architecture Constraints 技术栈 | 零新增依赖，包结构对齐既有模板 | PASS |
| Non-Goals（Fleet 1.0 前） | 未触碰（无 Dynamic DAG Replanning / LLM Scheduler / Agent 协商） | PASS |

## Project Structure

### Documentation (this feature)

```text
specs/006-m5-dag-scheduler/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── scheduler-api.md # 库 API 契约：TaskExecutor 端口 + run() + RunOutcome
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root，M5 增量)

```text
packages/scheduler/
├── src/
│   ├── index.ts         # 公共出口
│   ├── types.ts         # DagNode / TaskDag / RunOutcome / DispatchRecord / TaskExecutor 端口
│   ├── dag.ts           # buildDag（重复 id/悬空/自环/环检测报链）+ readyTasks + 状态视图
│   ├── config.ts        # SchedulerConfig（maxConcurrency ≥1 默认 3；retry ≥0 默认 1）
│   ├── scheduler.ts     # 调度循环（并发派发/收结果/重试/失败传播到不动点）
│   └── test-kit.ts      # ScriptedExecutor（脚本化假执行器：延迟/成败/异常 + 调用序与并发峰值记录）
├── package.json         # @fleet/scheduler（依赖 @fleet/mission + zod）
├── tsconfig.json        # 继承 base
└── tsup.config.ts       # 对齐模板

packages/scheduler/src/*.test.ts    # 拓扑矩阵 / 并发 / 传播 / 确定性（同包单测，无 e2e）
```

**Structure Decision**: roadmap 最终结构 `packages/scheduler` 独立包；
无 CLI 改动、无 mission 包改动（消费方单向依赖）；测试全部落在
包内（无进程级 e2e——本里程碑没有命令面）。

## Complexity Tracking

> 无宪法违规需要辩护，本表为空。

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
