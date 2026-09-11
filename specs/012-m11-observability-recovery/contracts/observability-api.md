# Contract: @fleet/observability 公共 API + CLI 行为

**Spec**: [../spec.md](../spec.md) | **Data Model**: [../data-model.md](../data-model.md)

## 1. EventSink

```ts
class EventSink {
  constructor(eventsPath: string);
  emit(event: { type: string; payload?: Record<string, unknown> }): void;
  // 即时 appendFileSync（FleetEvent 序列化：id/timestamp 自动）
}
function readEvents(eventsPath: string): { events: FleetEvent[]; skippedLines: number };
// 半行容错：尾行 parse 失败跳过并计数（不崩溃不吞）
```

## 2. RunStore

```ts
class RunStore {
  constructor(baseDir: string); // 缺省 <repoRoot>/.fleet/runs
  beginRun(mission: Mission, runShort: string): { dir, sink }; // mission.json（快照+指纹）+ events.jsonl 建立幂等
  finalize(runDir: string, report: RunReportLike): void;      // summary/usage/diff/validation 四面
}
```

RunReportLike = 结构面（run/outcome/budget/reviews/workspaces +
gate diff 字符串来源——executor 处置路径调用 store.writeDiff /
writeValidation）。

## 3. RunStatusView

```ts
function listRuns(baseDir: string): RunStatusView[];          // ps 数据面
function viewRun(runDir: string): RunStatusView;              // status 数据面（含 counts）
function readSummary(runDir: string): SummaryLike | undefined;
```

## 4. ResumePlan

```ts
function planResume(missionPath: string, runDir: string, fs): 
  | { ok: true; completedTaskIds: string[]; pendingTasks: Task[] }
  | { ok: false; reason: string };
function fingerprintOf(mission: Mission): string;
```

## 5. OrphanReport

```ts
function scanOrphans(repoRoot: string): { worktrees: OrphanEntry[]; processes: {pid, command}[] };
function cleanupOrphans(repoRoot: string, report, { force: boolean }): { cleaned: string[] };
// 缺省 dry-run；force 执行（进程 SIGTERM + worktree 最小清理）
```

## 6. scheduler / 执行域扩展

- `SchedulerConfig.shouldStop?: () => boolean`——run() 批次循环
  顶检查；stop → executor.cancelAll?.() → 当前批 settle →
  pending→skipped、在行未完成→cancelled、status='cancelled'。
- `TaskExecutor.cancelAll?()`——AgentTaskExecutor 对 in-flight
  runId 调 runtime.cancel；workspace 装饰器转发 inner。
- CliRuntimeAdapter 子进程命令行统一 `env FLEET_CHILD=1 <cmd>`
  前缀（孤儿识别标记）。

## 7. CLI 行为

| 命令 | 行为 | 退出码 |
|---|---|---|
| `fleet ps [--orphans]` | 列全部 run（mission/状态/进度/时间）；--orphans 附孤儿报告 | 0（空态友好） |
| `fleet status <mission>` | 任务分布表 + 摘要（最新 run） | 0/1（未知 mission=1） |
| `fleet logs <mission> [--type <前缀>]` | 事件时间线（过滤） | 0/1 |
| `fleet inspect <mission>` | 完整 RunReport/summary JSON | 0/1 |
| `fleet diff <mission>` | diff.patch 输出 | 0/1/2（无 diff=2） |
| `fleet cancel <mission>` | 写 cancel 标记；对已终态幂等提示 | 0/1 |
| `fleet clean [--force]` | 孤儿 dry-run / 清理 | 0 |
| `fleet run <path> [--resume [runDir]]` | 默认落盘；--resume 续跑（无参 = 最新 interrupted） | 0/1 |

## 8. run 集成（runner.ts）

- runMissionFile 构造 RunStore/EventSink：mission.created/started
  开局发射；executor 包装发射 task.queued/started/completed/
  failed/skipped；既有 mission.run.* → mission.* 别名映射；
  M9 gate 事件 / M10 budget 事件汇入 sink；终局 finalize 四面
  + mission.completed/failed/cancelled。
- RunnerOptions 增 `runStore?: RunStore`（CLI 注入；缺省库层不
  落盘——向后兼容）+ `resume?: { completedTaskIds }`（调度前
  过滤 + task.skipped 发射）。
