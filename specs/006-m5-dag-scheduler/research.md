# Research: M5 Task DAG + Scheduler

**Date**: 2026-09-11 | **Status**: 技术决策已定

关键输入：M4 Task/TaskRunStatus 实体（六态枚举含 skipped）、
宪法 V（Rule-based / 固定 retry / 固定并发 / 无动态重排）、
Node 单进程异步并发模型。

## D1 — DAG 表示：节点 Map + 双向邻接

- **Decision**: `TaskDag` 持 `Map<taskId, DagNode>`（保持 mission
  声明序的插入序）+ `dependents: Map<taskId, taskId[]>`（正向边，
  失败传播用）；依赖边直接读 `task.dependsOn`。状态查询走方法
  （readyTasks / statusOf / 终态计数），对外暴露 `snapshot()`
  （纯数据视图，断言与确定性测试的载体）。
- **Rationale**: Map 插入序 = 稳定派发序的免费来源（SC-006）；
  dependents 正向边让传播是 O(受影响子树) 而非全图扫描。
- **Alternatives considered**: 不可变持久结构（每步拷贝，调度
  循环里成本高且无消费者需要）；邻接矩阵（节点少但可读性差）。

## D2 — 环检测：DFS 三色 + 栈回溯报链

- **Decision**: 构建/增补时对任务图做 DFS 三色标记（white/
  gray/black），起点按声明序；遇到 gray 回边时从栈中回溯提取
  环链，报 `cycle: a -> b -> c -> a`（错误 detail 含完整链）。
- **Rationale**: Kahn 拓扑排序能判环但报不出链序（只剩节点集合，
  无序），SC-001 要求"精确报出环链"；DFS 栈回溯天然保序。
- **Alternatives considered**: Kahn + 剩余节点排序（伪造顺序，
  误导修复）。

## D3 — 就绪选择：声明序过滤

- **Decision**: `readyTasks()` = 声明序遍历节点，过滤
  `status === pending && dependsOn 全部 completed`。无缓存——
  每轮 O(V+E) 足够（百级节点、毫秒级）。
- **Rationale**: 稳定、可解释、"同状态同结果"结构性成立；
  优先级/加权排序是 Dynamic DAG 的入口，宪法 V 禁止。
- **Alternatives considered**: 拓扑层序（diamond 下 b/c 的相对
  序会偏离声明序，破坏确定性断言）。

## D4 — 调度循环：事件驱动 + 单点决策

- **Decision**: 循环体（决策串行、执行并发）：
  1. `propagateFailures()`（failed → 传递依赖 pending → skipped，
     迭代到不动点）；
  2. 派发：`readyTasks().slice(0, maxConcurrency - inflight.size)`
     逐个置 running、`attempts += 1`、记 DispatchRecord、调
     `executor.execute(task)`（不 await 全体，收集 inflight）；
  3. 无 inflight 且无 ready → 收敛，计算终态；否则
     `await Promise.race(inflight)`（settle 包装永不 reject——
     执行器异常在包装层等价为 `{ok:false}`）；
  4. settle：成功 → completed；失败且 `attempts ≤ retry` → 回
     pending（下轮重试）；失败且 `attempts > retry` → failed
     （回到 1 传播）。
- **Rationale**: 决策单线程化免除锁与竞态（"同一任务不双跑"由
  状态机保证）；Promise.race 等待最先完成者，空转轮询为零。
- **Alternatives considered**: 固定 tick 轮询（空转 + 时序抖动）；
  每任务独立 actor（复杂度远超需求，宪法 Guardrails：推迟）。

## D5 — 失败传播：不动点迭代 + 传播链

- **Decision**: 每轮循环开头对全部 failed 节点沿 dependents 做
  BFS：pending → skipped 并记录 `skippedBy`（首个 failed 祖先，
  BFS 序确定）；已 running 的任务让其自然结束（结果照常记录，
  终态不被传播改写——completed 优先）。RunOutcome.propagation
  = `Array<{ failedTaskId, skipped: string[] }>`（failed 声明序，
  skipped 各自声明序）。
- **Rationale**: "skipped 不改变已完成任务终态"（FR-007）与
  "running 自然收敛"避免取消语义（cancelled 属 M6+）；传播链
  显式可追溯（SC-005）。
- **Alternatives considered**: 传播时取消 running（引入取消协议，
  M6+ 范围）；只标直接依赖（传递依赖会永久 pending，图不收敛）。

## D6 — TaskExecutor 端口与 ScriptedExecutor

- **Decision**: 端口最小面：
  `execute(task: Task): Promise<{ ok: boolean; detail?: string }>`；
  异常由调度器的 settle 包装捕获等价失败（FR-008）。
  `test-kit.ts` 导出 ScriptedExecutor：`script: Record<taskId,
  Array<'success' | 'failure' | 'boom'>>`（按调用序出队，耗尽
  重复末项）+ `delayMs` + `callLog`（调用序）+ `peakConcurrency`
  （active 计数峰值，采样断言用）。
- **Rationale**: M6 RuntimeAdapter 适配此端口（宪法 IV 接缝）；
  peakConcurrency 采样比纯时序断言稳（SC-003 主证据，时序为辅）。
- **Alternatives considered**: 端口含 cancel/timeout（M6 契约，
  提前定死会被 RuntimeAdapter 真实需求推翻——Guardrails 推迟）。

## D7 — 配置：独立 SchedulerConfig

- **Decision**: `maxConcurrency: int 1..64 默认 3`、
  `retry: int 0..10 默认 1`（Zod，构造即校验）；与 core
  fleet.yaml 的 defaults 字段语义对齐（M6+ 接线时透传），但
  schema 独立在 scheduler 包（core 不感知 scheduler）。
- **Rationale**: 域值约束（FR-005/006 边界拒绝 0/负数）；包
  依赖方向干净。
- **Alternatives considered**: 复用 core fleetConfigSchema.defaults
  （core 反向感知 scheduler 语义，依赖倒置）。

## D8 — 测试策略与防抖

- **Decision**: 全部包内单元测试：
  1. **拓扑矩阵**（SC-001）：linear/parallel/diamond 全链状态
     断言；cycle/missing/self 构建拒绝 + 错误链断言；
  2. **并发**（SC-002/003）：3×120ms 无依赖 → 总耗时 < 300ms
     （串行 360ms 基线）且 peakConcurrency === 3；5 就绪 + 上限
     3 → peak === 3 且任意时刻 ≤ 3（executor 采样即证）；
  3. **重试/传播**（SC-004/005）：必败恰执行 retry+1 次；一败
     一成（重试成功）下游照常；传播链与终态三态矩阵（含空 DAG
     → completed）；
  4. **确定性**（SC-006）：同脚本双跑——dispatchOrder 与
     snapshot 终态逐项一致；
  5. **鲁棒**：执行器抛异常等价失败不击穿；maxConcurrency=1
     退化为串行。
- 时序断言阈值放宽（< 300ms 而非 < 200ms）防慢机抖动；峰值
  采样为主证据。
- **Rationale**: 无命令面 → 无 e2e；异步并发测试用真实 timer
  （假时钟会让"真实并发"验收失真）。

## D9 — 与 M4 的边界

- **Decision**: buildDag 自含图级三查（重复 id / 悬空 / 自环，
  约 20 行）+ 环检测；M4 semantic.ts 保持 Mission 文件级职责
  不动。集成路径：`buildDag(mission.tasks)`（Mission 已过 M4
  校验，图级三查是运行时动态任务的防线，FR-002 的"一致适用"）。
- **Rationale**: 抽公共 helper 需要 mission 反向导出任务级规则，
  跨包耦合换 20 行收益，不值。
