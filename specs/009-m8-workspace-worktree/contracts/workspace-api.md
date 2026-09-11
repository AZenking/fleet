# Contract: WorkspaceManager（M8）

**Date**: 2026-09-11 | **Spec**: [spec.md](../spec.md)

物理隔离层契约：写授权任务（M7 矩阵 reason/reflex）在专属 Git
Worktree 执行，主仓全程零污染（宪法 II 物理落点）。

## 接口

```ts
interface WorkspaceManager {
  create(taskId: string, options?: { runId?: string }): Promise<Workspace>;
  getDiff(workspace: Workspace): Promise<string>;
  merge(workspace: Workspace): Promise<MergeOutcome>;
  destroy(workspace: Workspace): Promise<DestroyOutcome>;
}
```

## 命名与位置

| 资源 | 形态 | 例 |
|---|---|---|
| worktree 目录 | `.fleet/worktrees/<runShort>-<taskId>` | `.fleet/worktrees/a1b2c3d4-build-core` |
| 分支 | `fleet/<runShort>/<taskId>` | `fleet/a1b2c3d4/build-core` |

runShort = runId 去 `run_` 前缀取前 8 位（runId 缺省 `adhoc`）。

## 操作语义

### create

前置校验（任一失败 → 结构化 WorkspaceFault，不产生任何资源）：

1. 目标是 git 仓库（`not_a_git_repo`）
2. 有基线提交（`empty_repo`）
3. 主仓干净（`status --porcelain` 为空 → 否则 `dirty_main`）
4. 分支不存在（`branch_collision`——区分残留候选与活动冲突）
5. 活动 worktree < 上限（默认 8，`limit_exceeded`）

成功：worktree 建于主仓 HEAD 基线；返回 Workspace（active）。

### getDiff

- `add -A -N`（intent-to-add：未跟踪新文件进 diff）→ `diff HEAD`
- 输出 unified diff；二进制文件标注（git 原生 `Binary files
  differ`）；仅该工作区变更
- 只动隔离区 index，不动主仓

### merge（不强合）

```text
隔离区 add -A + commit（nothing-to-commit → noop）
主仓 merge --no-ff <branch>
  ├─ 成功 → { merged, commit }
  └─ 冲突 → 解析 CONFLICT 文件清单 → merge --abort
            → { conflict, files }（双方保持 pre-merge，可重试/destroy）
```

### destroy（幂等）

`worktree remove --force` → `branch -D`；部分失败 →
`{ ok:false, residual:[...] }`（cleanup_partial）；资源已不存在
→ `{ ok:true }`。

## 孤儿检测与最小清理（M11 前的最小集）

```ts
inventory(): { active: Workspace[]; orphans: OrphanEntry[] };
cleanupOrphan(orphan): Promise<DestroyOutcome>;
```

orphan = `git worktree list` 中位于 `.fleet/worktrees/` 且不在
本管理器活动清单的条目。跨进程"无人认领"判定属 M11 Recovery。

## fleet run 集成

- 写授权角色（reason / reflex）→ 专属 worktree（运行时请求
  cwd = worktree 路径）；只读角色 → 主仓根（SC-005）。
- 默认策略 `auto`：任务成功 → merge；失败/跳过 → destroy。
  `--no-worktree`：整体关闭（回到 M7 行为）。
- RunReport 增可选 `workspaces: [{taskId, action, outcome,
  detail?}]`；M5 批次屏障保证串行依赖的后继基线含上游已合并
  变更。
- 处置失败（merge 冲突等）：任务按 M5 语义处理，run 不崩溃，
  故障进报告（SC-006）。

## 故障码总表

`not_a_git_repo / empty_repo / dirty_main / branch_collision /
limit_exceeded / cleanup_partial / git_failed`——全部
`{ code, detail }` 结构化，零崩溃，零主仓污染。
