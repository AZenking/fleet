# Data Model: M5 Task DAG + Scheduler

**Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

所有结构以 Zod / TS 定义于 `packages/scheduler/src/types.ts`；
端口与 RunOutcome 形状见 [contracts/scheduler-api.md](contracts/scheduler-api.md)。
任务实体（Task）与状态枚举（TaskRunStatus）复用 `@fleet/mission`。

## 1. DagNode

| 字段 | 类型 | 规则 |
|---|---|---|
| `taskId` | string | mission 内唯一（构建时查） |
| `task` | Task | 原始任务（executor 的输入） |
| `status` | enum | `pending / running / completed / failed / skipped`（cancelled 枚举存在但 M5 不触发） |
| `attempts` | integer | 执行次数（含进行中）；终态时 = 实际执行数 |
| `failureReason` | string? | 最后一次失败摘要（执行器 detail 或异常 message） |
| `skippedBy` | string? | skipped 时指向首个 failed 祖先（传播链） |

## 2. TaskDag

| 成员 | 类型 | 规则 |
|---|---|---|
| `nodes` | Map<taskId, DagNode> | 插入序 = mission 声明序（稳定派发序来源） |
| `dependents` | Map<taskId, taskId[]> | 正向边（失败传播 BFS 用） |

方法：`buildDag(tasks) → TaskDag`（构建即校验：重复 id /
悬空 / 自环 / **环检测**——错误 detail 含 `cycle: a -> b -> a`
链）；`readyTasks(): DagNode[]`（声明序过滤：pending ∧ 依赖全
completed）；`snapshot(): SnapshotNode[]`（纯数据视图）；
`counts()`（各状态计数，终态判定用）。

## 3. SchedulerConfig

| 字段 | 类型 | 默认 | 合法域 |
|---|---|---|---|
| `maxConcurrency` | integer | 3 | 1..64 |
| `retry` | integer | 1 | 0..10 |

构造即校验（FR-005/006 边界拒绝）；与 fleet.yaml defaults 语义
对齐（M6+ 接线）。

## 4. TaskExecutor（端口，M6 RuntimeAdapter 适配目标）

```ts
interface TaskExecutor {
  execute(task: Task): Promise<{ ok: boolean; detail?: string }>;
}
```

- 执行器**抛异常等价失败**（调度器 settle 包装捕获，detail =
  异常 message；FR-008 不击穿循环）。
- 无 timeout / cancel——RuntimeAdapter 的 timeoutMs 契约属 M6。

## 5. DispatchRecord / 调度序

| 字段 | 类型 | 规则 |
|---|---|---|
| `taskId` | string | |
| `seq` | integer | 派发序号（含重试的每次派发） |
| `attempt` | integer | 该任务第几次执行 |

`dispatchOrder`（RunOutcome 字段）= taskId 按序数组——SC-006
确定性断言的载体。

## 6. RunOutcome

| 字段 | 类型 | 规则 |
|---|---|---|
| `status` | enum | `completed / failed`（存在 failed → failed；否则全 completed 或空图 → completed） |
| `nodes` | SnapshotNode[] | 每任务终态 + attempts + failureReason + skippedBy |
| `dispatchOrder` | string[] | 全部派发（含重试） |
| `propagation` | Array<{ failedTaskId, skipped: string[] }> | 每个 failed → 其传递 skipped（各自声明序） |
| `durationMs` | integer | 全程耗时 |

## 状态转换（单节点状态机）

```text
pending ──派发──→ running ──成功──→ completed（终态）
   ↑                 │
   └──重试(attempts ≤ retry)──┘
                     └─失败且 attempts > retry─→ failed（终态，触发传播）
pending ──传播(存在 failed 祖先)──→ skipped（终态，记 skippedBy）
```

调度循环（决策串行，执行并发）：

```text
loop:
  1. propagateFailures（failed → 沿 dependents BFS：pending→skipped，到不动点）
  2. ready = readyTasks().slice(0, maxConcurrency - inflight)
     逐个: →running, attempts+1, 记 DispatchRecord, execute() 入 inflight
  3. inflight 空 且 ready 空 → 收敛 → RunOutcome
     否则 await Promise.race(inflight)（settle 永不 reject）
  4. settle: 成功→completed；失败且 attempts≤retry→pending；
             失败且 attempts>retry→failed（回到 1）
```

空 DAG：循环立即收敛，status = completed（FR-007）。

## 实体关系总览

```text
Mission.tasks（M4 实体）
   → buildDag → TaskDag（nodes + dependents）
Scheduler.run(dag, executor, config)
   → 决策循环（readyTasks / propagate）
   → TaskExecutor.execute（并发，M6 适配）
   → RunOutcome（nodes 终态 + dispatchOrder + propagation）
```
