# Data Model: M11 Observability + Recovery

**Date**: 2026-09-12 | **Spec**: [spec.md](../spec.md)

结构定义于 `packages/observability/src/types.ts`；契约见
[contracts/observability-api.md](contracts/observability-api.md)。

## 1. Run 目录布局（roadmap 原文 + runId 隔离）

```text
.fleet/runs/<mission-id>/<runShort>/
├── mission.json        # mission 快照 + fingerprint
├── events.jsonl        # FleetEvent 每行一条（即时追加）
├── summary.json        # 终局摘要（终态/任务表/门+预算摘要/累计 attempts）
├── usage.json          # ledger.snapshot() 终局
├── diff.patch          # 门通过最终变更面（写任务）
├── validation.json     # ReviewPackage[]
├── cancel-requested    # cancel 标记（存在即请求）
├── artifacts/          # 空占位（M12 形态）
└── logs/               # 空占位（M12 形态）
```

## 2. 事件类型全集（D2）

| 命名空间 | 类型 |
|---|---|
| mission | created / started / completed / failed / cancelled |
| task | queued / started / completed / failed / skipped |
| workspace | created / destroyed |
| validation | started / completed（M9 既有） |
| review | requested / approved / changes_requested / exceeded |
| budget | warning / exceeded |
| accelerator | codegraph.fallback / wiki.stale / evidence.conflict |

FleetEvent.type 正则已兼容（点分小写）。payload 语义见各发射点。

## 3. RunStatusView（ps / status 数据面）

| 字段 | 类型 | 规则 |
|---|---|---|
| `missionId` / `runShort` / `startedAt` | string | 目录与事件流 |
| `status` | `completed \| failed \| cancelled \| interrupted \| running*` | running = 进程持有（本期 CLI 不可判活——留 interrupted 语义：无终态即 interrupted） |
| `tasks` | `Array<{ taskId, status }>` | completed/failed/skipped/interrupted/pending |
| `counts` | `{ completed, failed, skipped, interrupted, pending }` | 重建聚合 |

## 4. ResumePlan

| 字段 | 类型 | 规则 |
|---|---|---|
| `ok` | boolean | 指纹一致且存在可续任务 |
| `reason?` | string | 拒绝原因（指纹漂移 / 无未完任务） |
| `completedTaskIds` | string[] | 事件流重建 |
| `pendingTasks` | Task[] | 调度输入裁剪 |
| `sourceRunDir` | string | 续写来源 |

## 5. OrphanReport

| 字段 | 类型 | 规则 |
|---|---|---|
| `worktrees` | OrphanEntry[]（M8） | inventory() 复用 |
| `processes` | `Array<{ pid, command }>` | 命令行含 FLEET_CHILD=1 标记 |
| 清理 | `cleanup(report, { force })` | 确认语义：默认 dry-run 列表，--force 执行（SIGTERM + worktree 清理原语） |

## 6. MissionFingerprint

`sha-like 简易哈希（djb2）`——`${id}|${taskId}:${role}:${deps
.join('+')}` 序列拼接；非加密用途（变更检测）。

## 7. scheduler 扩展

- `SchedulerConfig.shouldStop?: () => boolean`（批次屏障间检查）
- `TaskExecutor.cancelAll?(): Promise<void>`（可选端口）
- `runOutcomeStatusSchema` 增 `'cancelled'`；DagNode 终态含
  cancelled（pending → skipped；running 未 settle → cancelled）
