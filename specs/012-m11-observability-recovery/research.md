# Research: M11 Observability + Recovery

**Date**: 2026-09-12 | **Status**: 技术决策已定

关键输入：core FleetEvent 序列化（M0）、M8 inventory（孤儿
worktree 真相源 = `git worktree list --porcelain`）、M9
emitEvent 通道（gate → CLI stderr）、M10 ledger/优化统计、
M5 批次屏障调度（检查点插入位）、Fake cancel（M6 契约）、
CliRuntimeAdapter 子进程 spawn。

## D1 — RunStore 目录布局与写序

- **Decision**: `.fleet/runs/<mission-id>/<runShort>/`（runId 子
  目录隔离多次 run）；run 开始写 mission.json（快照 + 指纹），
  事件经 EventSink 即时 appendFileSync 进 events.jsonl，终局写
  summary.json（终态 + 任务表 + 门/预算摘要 + 累计 attempts）；
  usage.json = ledger.snapshot() 终局快照；diff.patch / 
  validation.json 由 gate/executor 处置路径写入（门通过 = 最终
  变更面；失败 = 销毁前 diff 尽力）。artifacts/ logs/ 空占位。
- **Rationale**: roadmap 原文结构 + runId 隔离（同 mission 多
  run 互不覆盖）；流式 append 保证 crash 已发生即已落盘。
- **Alternatives considered**: 整包终局写（crash 全丢）；DB
  （违 Non-Goal）。

## D2 — 事件全集接入面（单汇点）

- **Decision**: runMissionFile 内构造 EventSink，把既有
  MissionRunEvent（mission.run.*）扩为全集发射：mission.created/
  started/completed/failed/cancelled、task.queued/started/
  completed/failed/skipped（scheduler 回调或 runner 包装 executor
  发射——选 runner 包装：executor.execute 前后 + outcome 归并，
  不改 TaskExecutor 契约）；workspace/validation/review 事件沿
  M9 emitEvent 注入汇点；budget.warning（压缩发生）/exceeded
  （Reject）在 M10 builder/executor 路径发射；加速器三类
  （codegraph.fallback/wiki.stale/evidence.conflict）在
  repository 包对应分支补发（emitEvent 可选注入，缺省丢弃——
  不改既有函数行为的默认面）。
- **Rationale**: 单汇点（EventSink）落盘 + CLI stderr 双消费；
  发射点复用既有通道，零新管道。
- **Alternatives considered**: 每域各自写盘（多文件无序）；事件
  总线抽象（过度设计，M12 再议）。

## D3 — cancel 通道

- **Decision**: `fleet cancel <mission>` 写 `.fleet/runs/<id>/
  <runShort>/cancel-requested` 标记；runMissionFile 构造
  shouldStop = () => existsSync(标记)（批次屏障间轮询，间隔 =
  每批一次——零额外线程）；scheduler.run 循环顶检查：stop →
  `executor.cancelAll?.()`（AgentTaskExecutor 实现：对 in-flight
  runId 调 runtime.cancel）→ 等当前批 settle（cancel 使 hang
  立即 settle）→ pending → skipped、running 未完成 → cancelled、
  outcome.status = 'cancelled'（runOutcomeStatusSchema 增枚举）。
- **Rationale**: 单机单进程模型最小实现；批次屏障检查保调度
  确定性（宪 V）；runtime.cancel 通道既有（宪 IV）。
- **Alternatives considered**: SIGINT 信号（跨平台语义不稳）；
  WebSocket/IPC（M12 域）。

## D4 — 中断识别与视图重建

- **Decision**: RunStatusView.fromEvents(events)：终态 = 最后
  mission.* 终态事件；无终态且有 started → interrupted；无
  started → 不列（从未开始语义）。任务分布：task.completed 集 /
  task.started 未 completed → interrupted / 其余 pending；
  cancelled 单列。
- **Rationale**: 纯事件流重建（事实记录唯一真相源，宪 I）；
  边缘用例（未写 started）在 spec 已钉死语义。
- **Alternatives considered**: 状态文件快照（与事件流可能漂移）。

## D5 — ResumePlan 与指纹

- **Decision**: resume(missionPath, runDir)：读 mission.json 的
  fingerprint = `${mission.id}:${sortedTasks.map(t => `${t.id}:
  ${t.agentRole}:${t.dependsOn.join('+')}`).join('|')}`；当次
  mission 重算比对——不一致拒绝。完成集 = 事件流 task.completed
  的 taskId；调度输入 = tasks.filter(未完成)；已完成任务的
  review/budget 事实已在盘（usage 累计 = 终局 summary 的累计
  attempts + 新 run 计数——新 run 续写同 mission 目录新 runShort）。
- **Rationale**: 任务级原子（spec 钉死）；指纹防"旧进度跑新
  任务集"；复跑不重做（验收锚点）。
- **Alternatives considered**: 半任务续传（违原子性）；忽略指纹
  （静默错配，危险）。

## D6 — 孤儿进程识别与清理

- **Decision**: CliRuntimeAdapter spawn 统一注入 env
  `FLEET_CHILD=1`；OrphanReport.scanProcesses()：`ps -eo pid,ppid,
  etime,command` 过滤 command 含 `FLEET_CHILD=1` 或 env 标记不可
  得时按 Fleet 已知 CLI 命令名启发 + `fleet clean --force` 仅清
  有标记者（ps 输出不含 env——macOS 用 `ps -E` 不可靠，改用
  命令行包装：派生时 `env FLEET_CHILD=1 <cmd>` → ps command 列
  可见标记，可靠）。清理 = SIGTERM。
- **Rationale**: 不误杀（只清命令行可见标记者）；零依赖（系统
  ps）；M8 worktree 孤儿复用 inventory。
- **Alternatives considered**: /proc（非跨平台）；pid 文件登记
  （crash 时同样丢失——本质相同但复杂）。

## D7 — 半行容错

- **Decision**: readEvents()：逐行 parse，尾行 parse 失败 → 跳过
  并返回 `{ events, skippedLines }`（标注而非吞）。
- **Rationale**: kill -9 恰在 append 中间（appendFileSync 单次
  write 原子性在 POSIX 对小行足够，但防御性容错成本极低）。
