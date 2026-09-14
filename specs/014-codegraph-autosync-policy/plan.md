# Implementation Plan: CodeGraph 索引自动维护策略（stale→sync / uninitialized→init）

**Branch**: `014-codegraph-autosync-policy` | **Date**: 2026-09-14 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/014-codegraph-autosync-policy/spec.md`

## Summary

新增 `CodeGraphMaintainer` 独立接缝（init/sync 子进程封装 + 超时 +
Fake 注入面；**只读 adapter 红线原样保留**——写操作隔离在新组件）；
investigate 健康检查处按策略（manual/sync/auto，经 InvestigateOptions
注入，调用方从 configs/fleet.yaml 解析）触发至多一次维护并重查健康；
维护事件（codegraph.init/sync.started/completed/failed）并入 M11
事件流；core config schema 增 codegraph 段；CLI `--codegraph-maintain`
旗标覆盖；MCP repo_investigate 同语义。默认 manual 全量零变化。

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 24（同基线）

**Primary Dependencies**: 零新增——@fleet/core（config schema）、
execa（维护子进程）、既有 investigate/health/adapter 结构

**Storage**: 无（索引产物归 codegraph 自身资产）

**Testing**: 单元（FakeMaintainer 三态 × 三档矩阵 / 单次语义 /
事件断言）+ 既有 investigate 全量回归（manual 零变化）

**Target Platform**: macOS 本地（codegraph CLI 子进程）

**Project Type**: packages/repository 新组件 + investigate 挂点 +
core config 扩展 + CLI/MCP 接线

**Performance Goals**: 维护超时默认 300s；单次语义结构性保证

**Constraints**: 只读 adapter 不改（红线保留）；降级链与现状逐字节
一致；默认 manual 零行为变化

**Scale/Scope**: 三档策略 ×（init|sync）×（成功|失败|超时）矩阵

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 宪法条款 | 评估 | 结果 |
|---|---|---|
| I. Repository Truth Model | 维护失败只降级（慢/费 Token），调查永不失败——降级链零改动 | PASS |
| II. 权限与隔离 | 索引是 codegraph 自身资产；维护经用户显式 opt-in 配置授权 | PASS |
| III. Independent Validation | 无涉 | PASS |
| IV. Role/Runtime 解耦 | 无涉（Repository Intelligence 层内特性） | PASS |
| V. Deterministic Kernel First | 策略为确定性规则（档位→动作→单次→重查）；无 LLM、无循环重试 | PASS |
| VI. Reuse Over Reimplementation | 维护 = 子进程封装现成 codegraph CLI；只读 adapter 红线原样保留（写操作隔离到独立 Maintainer 接缝，cli-adapter.ts 的"一律禁止"注释对该文件继续成立） | PASS |
| Architecture Constraints 技术栈 | config schema 扩展对齐 core；零新增依赖 | PASS |
| Non-Goals | 无触（非后台守护/非定时任务——仅 investigate 入口同步触发） | PASS |

## Project Structure

### Documentation (this feature)

```text
specs/014-codegraph-autosync-policy/
├── plan.md / research.md / data-model.md / quickstart.md
├── contracts/
│   └── maintainer-api.md  # Maintainer 契约 + 策略状态机 + 配置/事件
└── tasks.md
```

### Source Code (repository root，增量)

```text
packages/repository/src/codegraph/
├── maintainer.ts             # 新：CodeGraphMaintainer 接口 + Cli 实现（execa init/sync + 超时）+ Fake（脚本注入 + 调用记录）
├── cli-adapter.ts            # 不改（只读红线保留）
└── contract.ts               # 不改

packages/repository/src/investigation/
├── types.ts                  # InvestigateOptions 增 codegraph?: { policy, timeoutMs?, maintainer? }
├── investigate.ts            # 健康检查处策略挂点（单次维护 → 重查 → 事件 → fallback 记录）
└── investigate.test.ts       # 三档矩阵 + 故障三态 + 单次语义回归

packages/core/src/config/
└── schema.ts                 # fleetConfigSchema 增 codegraph 段（autoMaintain/timeoutMs）

apps/cli/src/commands/repo.ts # --codegraph-maintain 旗标 + configs/fleet.yaml 解析注入
packages/mcp/src/repo-tools.ts# repo_investigate 配置解析（同语义）
```

**Structure Decision**: 写操作独立 Maintainer（不扩只读 adapter 契约
——M1 红线对 cli-adapter.ts 继续成立）；investigate 保持纯函数
（策略经 options 注入，配置解析归调用方——CLI/MCP 同源）。

## Complexity Tracking

> 无宪法违规需要辩护，本表为空。

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
