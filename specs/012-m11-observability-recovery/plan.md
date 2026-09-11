# Implementation Plan: M11 Observability + Recovery（可观测与恢复）

**Branch**: `012-m11-observability-recovery` | **Date**: 2026-09-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/012-m11-observability-recovery/spec.md`

## Summary

新增 `packages/observability`：RunStore（`.fleet/runs/<mission-id>/`
流式落盘——mission.json 指纹快照、events.jsonl 即时追加、终局
summary/usage/diff/validation 四面）+ RunStatusView（事件流重建
ps/status 数据面）+ ResumePlan（完成集重建 + 指纹校验）+ OrphanReport
（M8 worktree 清单 + FLEET_CHILD 进程扫描）。事件全集接入：
executor/gate 既有 emitEvent 统一汇入 EventSink；task.* 生命周期
由 runner 发射；budget.warning/exceeded 接 M10 压缩/拒绝路径；
加速器三类事件补发射点。scheduler 增 shouldStop 检查点 + 可选
cancelAll 端口（cancelled 终态）；fleet run 默认落盘 + `--resume`；
CLI 六命令（ps/status/logs/inspect/diff/cancel）+ 孤儿清理
（`fleet ps --orphans` / `fleet clean`）。零新增依赖。

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 24（同基线）

**Primary Dependencies**: 零新增——core（FleetEvent 序列化/ids/fs）、
mission（schema/指纹）、scheduler（shouldStop 检查点）、runtime
（run 编排接缝）、workspace（inventory）、validation（ReviewPackage）、
budget（usage 快照）、agents（cancelAll 端口）

**Storage**: `.fleet/runs/<mission-id>/`（roadmap 原文结构；
已被根 .gitignore 的 `.fleet/` 覆盖）

**Testing**: 单元（EventSink 流式/半行容错、View 重建矩阵、
ResumePlan 指纹、OrphanReport 识别）+ 集成（runMissionFile 落盘
一致性）+ e2e（kill -9 中断 → ps interrupted → resume 完成集
裁剪 → 孤儿清理归零；cancel hang run → cancelled）

**Target Platform**: macOS 本地（ps 进程扫描、kill -9）

**Project Type**: monorepo 新增 packages/observability + scheduler/
runtime/agents/cli/repository 多点接入 + CLI 六命令

**Performance Goals**: 事件即时落盘（appendFileSync 语义即可——
单机单 run，吞吐非瓶颈）；ps/status 大 run 目录秒级

**Constraints**: 半行容错；指纹防漂移；不误杀进程；e2e 不触碰
本仓库工作区（.fleet/runs 落在 tmp 仓库）

**Scale/Scope**: 事件全集 ~20 型；六命令；五类恢复语义

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 宪法条款 | 评估 | 结果 |
|---|---|---|
| I. Repository Truth Model | 加速器三类事件（fallback/stale/conflict）只补发射点不改行为；视图全部从事件流（事实记录）重建 | PASS |
| II. 权限与隔离 | 孤儿进程按 FLEET_CHILD 派生标记识别清理（不误杀）；落盘只在 .fleet/（忽略区） | PASS |
| III. Independent Validation | validation.json/diff.patch 落盘的是 M9 Artifact 事实——不改判定路径 | PASS |
| IV. Role/Runtime 解耦 | cancel 经 runtime.cancel 通道（Fake/CLI 同契约）；resume 不绑运行时 | PASS |
| V. Deterministic Kernel First | shouldStop 检查点在批次屏障间（调度确定性保持）；cancel/resume 语义全规则化；无动态重排 | PASS |
| VI. Reuse Over Reimplementation | 事件序列化复用 core；孤儿 worktree 复用 M8 inventory；usage 复用 M10 ledger；进程扫描复用系统 ps | PASS |
| Architecture Constraints 技术栈 | packages/observability 对齐 roadmap 终局；零新增依赖 | PASS |
| Non-Goals（Fleet 1.0 前） | 未触碰（分布式 / DB 持久化 / 跨机恢复均不做——纯文件） | PASS |

## Project Structure

### Documentation (this feature)

```text
specs/012-m11-observability-recovery/
├── plan.md / research.md / data-model.md / quickstart.md
├── contracts/
│   └── observability-api.md  # RunStore/View/Resume/Orphan/CLI 契约
└── tasks.md
```

### Source Code (repository root，M11 增量)

```text
packages/observability/
├── src/
│   ├── index.ts           # 公共出口
│   ├── types.ts           # 目录结构常量 / 视图实体 / ResumePlan / OrphanReport
│   ├── sink.ts            # EventSink（流式追加 + FleetEvent 序列化 + 半行容错读取）
│   ├── store.ts           # RunStore（目录生命周期 + 四面终局写）
│   ├── view.ts            # RunStatusView（事件流 → ps/status 数据面）
│   ├── resume.ts          # ResumePlan（完成集重建 + MissionFingerprint 校验）
│   ├── orphan.ts          # OrphanReport（worktree inventory + FLEET_CHILD 进程扫描）
│   └── *.test.ts
├── package.json           # @fleet/observability（core+mission+workspace）
└── tsconfig / tsup

packages/scheduler/src/{types,scheduler}.ts  # shouldStop 检查点 + cancelled 终态 + cancelAll 端口
packages/runtime/src/runner.ts               # task.* 事件发射 + RunStore 接线 + resume 入口
packages/agents/src/executor.ts              # cancelAll（runtime.cancel in-flight）
packages/runtime/src/cli-adapter.ts          # FLEET_CHILD env 标记
packages/repository/src/**                   # codegraph.fallback / wiki.stale / evidence.conflict 发射点
packages/budget/src/ledger.ts 或 context     # budget.warning / exceeded 事件发射
apps/cli/src/commands/{ps,status,logs,inspect,diff,cancel,clean}.ts
apps/cli/src/commands/run.ts                 # 默认落盘 + --resume
tests/cli/recovery.test.ts                   # e2e：kill/resume/cancel/orphan
```

**Structure Decision**: 观测域独立成包（数据面 CLI 全部只读
`.fleet/runs/`——与执行域解耦，M12 Control Center 直接复用
View/Store API）；cancel 通道 = 标记文件 + 批次屏障检查（单机
单进程语义，M12 可换实现）。

## Complexity Tracking

> 无宪法违规需要辩护，本表为空。

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
