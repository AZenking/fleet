# Data Model: M8 Workspace + Git Worktree

**Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

结构定义于 `packages/workspace/src/types.ts`；契约细节见
[contracts/workspace-api.md](contracts/workspace-api.md)。复用：
M7 ROLE_PERMISSIONS（runtime 单一来源）、M5 TaskExecutor、
core FleetError/ConfigIssue。

## 1. Workspace

| 字段 | 类型 | 规则 |
|---|---|---|
| `taskId` | string | 归属任务（M4 唯一性保证） |
| `runId` | string | 归属 run |
| `path` | string | `.fleet/worktrees/<runShort>-<taskId>`（绝对） |
| `branch` | string | `fleet/<runShort>/<taskId>` |
| `baseline` | string | create 时的主仓 HEAD（sha） |
| `status` | enum | `active / merged / conflict / destroyed` |

## 2. WorkspaceManager（接口，roadmap 签名）

```ts
interface WorkspaceManager {
  create(taskId: string, options?: { runId?: string }): Promise<Workspace>;
  getDiff(workspace: Workspace): Promise<string>;
  merge(workspace: Workspace): Promise<MergeOutcome>;
  destroy(workspace: Workspace): Promise<DestroyOutcome>;
}
```

`runId` 缺省 = `adhoc`（库层直接使用场景）；run 集成传入真实
runId。

## 3. MergeOutcome（discriminated）

| 形态 | 字段 | 规则 |
|---|---|---|
| `merged` | commit: string | 主分支新 HEAD |
| `conflict` | files: string[] | 冲突文件清单；双方保持 pre-merge |
| `noop` | — | 空 diff（无提交发生，不算失败） |
| `rejected` | reason: string | 前置不满足（如主仓变 dirty） |

## 4. DestroyOutcome

| 字段 | 类型 | 规则 |
|---|---|---|
| `ok` | boolean | 全部清理成功（含幂等"已不存在"） |
| `residual` | string[] | cleanup_partial 时的残留项（worktree / branch） |

## 5. WorkspaceFault

| code | 触发 | detail 要素 |
|---|---|---|
| `not_a_git_repo` | 非 git 仓库 | 路径 |
| `empty_repo` | 无任何提交 | — |
| `dirty_main` | 主仓有未提交变更 | 首个脏文件 |
| `branch_collision` | 分支已存在 | 分支名 + 残留/活动判定 |
| `limit_exceeded` | 活动 worktree ≥ 上限（默认 8） | 当前数 |
| `cleanup_partial` | destroy 部分失败 | 残留项 |
| `git_failed` | git 子命令非零/超时 | 命令 + stderr 首行 |

全部经 FleetError（category 'internal'）抛出或以 Outcome 返回
（create/merge/destroy 用 Outcome 语义，不抛断调用方）。

## 6. WorkspaceInventory

| 字段 | 类型 | 规则 |
|---|---|---|
| `active` | Workspace[] | 本管理器活动清单 |
| `orphans` | OrphanEntry[] | `git worktree list` 中位于 `.fleet/worktrees/` 且不在活动清单 |

**OrphanEntry**: `{ path, branch?, detectedAt }`；
`cleanupOrphan(entry)` = destroy 同序列。

## 7. WorkspaceResolvingExecutor（TaskExecutor 装饰器）

- 构造：`{ inner: TaskExecutor, manager, repoRoot, policy? }`
- `policy`：`auto`（默认：成功 merge / 失败 destroy）|
  `keep-on-finish`（全部保留供人工）
- execute(task)：
  - 只读角色（ROLE_PERMISSIONS === READ_ONLY）→ inner 直接执行
    （cwd = repoRoot）
  - 写授权角色 → create worktree → inner 执行（cwd 查表）→
    auto 策略处置 → 处置记录
- **记录面**：`dispositions: Array<{ taskId, action:
  merged|destroyed|kept|conflict, outcome?, detail? }>`（runner
  duck-typing 读取进 RunReport.workspaces）

## 8. RunReport 扩展（可选字段，向后兼容）

| 字段 | 类型 | 规则 |
|---|---|---|
| `workspaces?` | Disposition[] | 每个 worktree 任务的处置（action/outcome/detail） |

## 状态转换

```text
create: (无) → active（基线=主仓 HEAD）
getDiff: active 任意时刻（工作树快照，无状态迁移）
merge: active → merged（成功）| conflict（冲突，仍 active 可重试/destroy）
destroy: 任一状态 → destroyed（目录+分支清理；幂等）
孤儿: active（持有进程消失）→ inventory.orphans → cleanupOrphan → destroyed
```

## 实体关系总览

```text
Mission.task(agentRole)
  → ROLE_PERMISSIONS（M7 单一来源）
  → WorkspaceResolvingExecutor
       ├─ READ_ONLY → inner executor（cwd=主仓根）
       └─ 写授权 → GitWorktreeManager.create → cwd=worktree
            → inner executor → 结果处置（auto 策略）
                 ├─ 成功 → merge → 主分支（M5 批次屏障保证后继基线含上游）
                 └─ 失败 → destroy（零泄漏）
  → Disposition[] → RunReport.workspaces
```
