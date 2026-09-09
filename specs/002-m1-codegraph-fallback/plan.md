# Implementation Plan: M1 CodeGraph + Fallback（仓库调查链路）

**Branch**: `002-m1-codegraph-fallback` | **Date**: 2026-09-09 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-m1-codegraph-fallback/spec.md`

## Summary

建立 Repository Investigation 第一条完整链路：`fleet repo investigate
"<问题>"` 经确定性策略编排 CodeGraph 适配层（CLI 子进程 + JSON 输出）
与原生回退（ripgrep → 源码阅读 → 文件遍历兜底），七类降级触发全部
结构化记录，调查永不因 CodeGraph 失败而失败（宪法原则 I）。新增
`packages/repository` 包，复用 M0 core 全部基础能力。

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 24（同 M0 工程基线）

**Primary Dependencies**: 既有 execa / Zod / yaml / commander / Vitest /
tsup（零新增第三方依赖）；外部工具依赖：`codegraph`（已装 v1.4.1）、
`rg`（缺失时自动降级内置遍历）、`git`

**Storage**: 无数据库；`.codegraph/` 归 CodeGraph 自有（Fleet 只读不
写，宪法原则 VI）；Fleet 侧仅内存结果 + 事件流（stderr）

**Testing**: Vitest；夹具仓库 `tests/fixtures/sample-repo`（已知符号集）
+ FakeCodeGraphAdapter 注入 + PATH 隔离故障注入

**Target Platform**: macOS 本地（同 M0）

**Project Type**: monorepo 新增 packages/repository（库）+ cli 命令

**Performance Goals**: 健康路径 investigate ≤ 10s（SC-001）；单次
codegraph 调用超时 5s、rg 3s / 结果上限 100 条、源码复核条数上限 20

**Constraints**: 确定性策略（FR-011，无 LLM）；宪法原则 I——任何
CodeGraph 故障只允许降级不允许失败；Static Truth = Source（FR-008）

**Scale/Scope**: 单仓库调查（monorepo 感知：路径提示可缩小范围）；
故障注入矩阵 7 场景 100% 自动降级（SC-002）

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 宪法条款 | 评估 | 结果 |
|---|---|---|
| I. Repository Truth Model | FR-005/006 七类触发全部降级；关键证据锚定源码；stale 只检测不重建（重建建议写入 fixSuggestion） | PASS |
| II. 权限与隔离 | M1 无 Agent 角色；repository 包只读仓库与 .codegraph | PASS（N/A 项无违反） |
| III. Independent Validation | N/A（无实现型角色自报问题） | PASS |
| IV. Role/Runtime 解耦 | CodeGraphAdapter 能力面隔离版本与接入方式；假后端可替换（SC-005） | PASS |
| V. Deterministic Kernel First | 调查策略为纯规则（FR-011），无 LLM、无动态重规划 | PASS |
| VI. Reuse Over Reimplementation | 只封装 codegraph CLI；不自研索引/AST；rg 直接复用 | PASS |
| Architecture Constraints 技术栈 | 全部沿用 M0 已装依赖，零新增 | PASS |
| Non-Goals（Fleet 1.0 前） | 未触碰任何禁止项 | PASS |

## Project Structure

### Documentation (this feature)

```text
specs/002-m1-codegraph-fallback/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── cli.md           # fleet repo investigate 命令契约
│   └── codegraph-adapter.md  # 适配层接口契约（含 CLI 映射）
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root，M1 增量)

```text
packages/repository/
├── src/
│   ├── index.ts                    # 公共出口
│   ├── codegraph/
│   │   ├── contract.ts             # CodeGraphAdapter 接口 + 结果/失败结构
│   │   ├── cli-adapter.ts          # execa 驱动 codegraph CLI（--json）
│   │   └── health.ts               # status --json → CodeGraphHealth + stale 判定
│   ├── fallback/
│   │   ├── search.ts               # rg --json / 内置遍历双实现
│   │   ├── source.ts               # 源码阅读 + 锚点存在性校验（静态真源）
│   │   └── git.ts                  # git 元信息辅助（最近变更/文件清单）
│   └── investigation/
│       ├── planner.ts              # 问题 → 检索计划（符号/关键词确定性提取）
│       ├── policy.ts               # 结果有效性判定 + 升级规则（含高风险模式）
│       └── investigate.ts          # 编排：codegraph → validate → fallback → 汇总
├── package.json
└── tsconfig.json

apps/cli/src/commands/repo.ts       # fleet repo investigate 子命令注册

tests/
├── cli/investigate.test.ts         # 进程级 e2e（含故障注入矩阵）
└── fixtures/sample-repo/           # 已知符号集的夹具仓库（见 research.md D6）
```

**Structure Decision**: 遵循 roadmap M1 的 packages/repository 三模块
划分（codegraph / fallback / investigation）；core 与 cli 不改结构，
cli 仅新增 repo 命令注册。

## Complexity Tracking

> 无宪法违规需要辩护，本表为空。

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
