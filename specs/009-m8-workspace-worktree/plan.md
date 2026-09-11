# Implementation Plan: M8 Workspace + Git Worktree（物理工作区隔离）

**Branch**: `009-m8-workspace-worktree` | **Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/009-m8-workspace-worktree/spec.md`

## Summary

新增 `packages/workspace`：WorkspaceManager 接口 + GitWorktreeManager
（git worktree 子进程序列——create 校验/建区、getDiff 含未跟踪、
merge 不强合、destroy 幂等清理）、孤儿检测与最小清理、六类故障
结构化。`fleet run` 集成：写授权角色（M7 矩阵驱动）在专属
worktree 执行（per-task cwd 解析进 AgentTaskExecutor），只读角色
在主仓根；默认策略成功即合 / 失败即弃（`--no-worktree` 关闭）。
零新增依赖；e2e 全程 tmp git 仓库。

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 24（同基线）

**Primary Dependencies**: 零新增——execa（git 子进程）、
`@fleet/core`（FleetError/ConfigIssue、探测）、`@fleet/runtime`
（ROLE_PERMISSIONS 矩阵单一来源——M7 决策）、`@fleet/mission`
（Task/AgentRole）、`@fleet/scheduler`（TaskExecutor 接缝）

**Storage**: `.fleet/worktrees/<runShort>-<taskId>`（已被根
`.gitignore` 的 `.fleet/` 覆盖——主仓不感知）；分支
`fleet/<runShort>/<taskId>`

**Testing**: 单元（tmp git 夹具仓库驱动 GitWorktreeManager 全
生命周期与故障矩阵）+ 集成（WorkspaceResolvingExecutor + Fake
touchOnSuccess 写行为）+ e2e（tmp 仓库 + write-cli 替身 + 主仓
干净轮询采样 SC-002）

**Target Platform**: macOS 本地（git worktree 原生支持）

**Project Type**: monorepo 新增 packages/workspace + agents 执行器
小扩展（per-task cwd resolver，向后兼容）+ fleet run 接线

**Performance Goals**: worktree add/merge 毫秒~百毫秒级（小仓）；
git 子命令超时 5s；并行双 worktree 隔离零互相可见

**Constraints**: merge 不强合（冲突 abort 双方保持 pre-merge）；
主仓 dirty 即拒绝；活动 worktree 上限默认 8；e2e 不触碰本仓库
工作区（全部 tmp）

**Scale/Scope**: 单机 git；六类故障 100% 结构化；SC-002 三段式
验收锚点

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 宪法条款 | 评估 | 结果 |
|---|---|---|
| I. Repository Truth Model | N/A（不消费加速器） | PASS |
| II. 权限与隔离 | **本里程碑的物理落点**：写授权限入隔离 worktree（M7 请求级 → 物理级）；只读角色物理范围最小化（主仓根）；矩阵单一来源复用（runtime 包） | PASS |
| III. Independent Validation | merge 前验证门属 M9——M8 的 merge 是显式调用，默认策略仅为一种调用方（边界清晰） | PASS |
| IV. Role/Runtime 解耦 | worktree 分配按角色权限而非具体运行时——任意适配器（Fake/替身/真实 CLI）同一隔离语义 | PASS |
| V. Deterministic Kernel First | worktree 命名 / 处置策略全确定性规则；无 LLM | PASS |
| VI. Reuse Over Reimplementation | git worktree 机制复用（不自研拷贝同步）；矩阵/错误模型/事件复用既有包 | PASS |
| Architecture Constraints 技术栈 | packages/workspace 对齐模板；零新增依赖 | PASS |
| Non-Goals（Fleet 1.0 前） | 未触碰（跨进程完整恢复 / 巡检 CLI 属 M11；多目标分支策略属 M12） | PASS |

## Project Structure

### Documentation (this feature)

```text
specs/009-m8-workspace-worktree/
├── plan.md / research.md / data-model.md / quickstart.md
├── contracts/
│   └── workspace-api.md  # WorkspaceManager 契约 + 故障码 + merge 语义
└── tasks.md
```

### Source Code (repository root，M8 增量)

```text
packages/workspace/
├── src/
│   ├── index.ts           # 公共出口
│   ├── types.ts           # Workspace / MergeOutcome / WorkspaceFault / WorkspaceInventory
│   ├── git.ts             # 受控 git 子进程（超时/错误→结构化）
│   ├── manager.ts         # GitWorktreeManager（create/getDiff/merge/destroy + 活动清单与上限）
│   ├── inventory.ts       # 孤儿检测（git worktree list 对照活动清单）+ 最小清理
│   └── executor.ts        # WorkspaceResolvingExecutor（写角色建区/处置，包装 AgentTaskExecutor）
├── package.json           # @fleet/workspace（core + runtime + mission + scheduler）
└── tsconfig / tsup

packages/agents/src/executor.ts   # 小扩展：config.cwd 支持 (task) => string resolver（向后兼容）
packages/runtime/src/fake.ts      # 小扩展：touchOnSuccess 写行为注入（测试替身）
packages/runtime/src/runner.ts    # RunReport 增可选 workspaces 处置记录
apps/cli/src/commands/run.ts      # worktree 集成接线（默认启用，--no-worktree 关闭）
tests/fixtures/fake-clis/write-cli.sh   # 写文件替身（e2e 写动作）
tests/cli/workspace.test.ts       # e2e：并行隔离三段式 + 故障注入 + 生命周期
```

**Structure Decision**: roadmap 最终结构 `packages/workspace` 独立包；
worktree 分配逻辑按 M7 权限矩阵（runtime 单一来源）判定——
workspace 不复制矩阵；执行器装饰器模式包装（AgentTaskExecutor
加 per-task cwd resolver，最小侵入向后兼容）。

## Complexity Tracking

> 无宪法违规需要辩护，本表为空。

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
