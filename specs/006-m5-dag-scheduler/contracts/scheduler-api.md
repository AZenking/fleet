# Contract: @fleet/scheduler 库 API（M5）

**Date**: 2026-09-11 | **Spec**: [spec.md](../spec.md)

M5 无 CLI 命令（`fleet run` 属 M6）——本契约是**库 API**：
M6 RuntimeAdapter、M7+ Agent 层从这里消费。数据结构见
[data-model.md](../data-model.md)。

## 构建任务图

```ts
import { buildDag } from '@fleet/scheduler';
import type { Task } from '@fleet/mission';

const dag = buildDag(tasks: Task[]): TaskDag;
// 构建即校验：重复 id / 悬空依赖 / 自环 / 多节点环
// 环错误 detail：cycle: a -> b -> c -> a（精确链序）
// 非法输入抛 FleetError（context.issues 同 ConfigIssue 结构）
```

## 调度

```ts
import { Scheduler, SchedulerConfig } from '@fleet/scheduler';
import type { TaskExecutor } from '@fleet/scheduler';

const config: SchedulerConfig = { maxConcurrency: 3, retry: 1 }; // 缺省值
const scheduler = new Scheduler(config);
const outcome = await scheduler.run(dag, executor);
```

**TaskExecutor 端口**（M6 RuntimeAdapter 的适配目标）：

```ts
interface TaskExecutor {
  execute(task: Task): Promise<{ ok: boolean; detail?: string }>;
}
```

- 执行器抛异常 ≡ 失败（不击穿调度循环，detail = 异常 message）
- 无 timeout / cancel——属 M6 RuntimeAdapter 契约

## RunOutcome

```json
{
  "status": "failed",
  "nodes": [
    { "taskId": "analyze", "status": "completed", "attempts": 1 },
    { "taskId": "verify", "status": "failed", "attempts": 2,
      "failureReason": "模拟失败" },
    { "taskId": "report", "status": "skipped", "attempts": 0,
      "skippedBy": "verify" }
  ],
  "dispatchOrder": ["analyze", "verify", "verify"],
  "propagation": [
    { "failedTaskId": "verify", "skipped": ["report"] }
  ],
  "durationMs": 246
}
```

## 保证（测试即契约）

| 保证 | 断言来源 |
|---|---|
| running ≤ maxConcurrency 恒成立 | ScriptedExecutor.peakConcurrency 采样 |
| 真实并发（非串行轮询） | 3×120ms 任务总耗时 < 300ms（串行基线 360ms） |
| 同 DAG + 同脚本 → 同派发序列 | dispatchOrder 双跑逐项一致 |
| 失败恰执行 retry+1 次 | attempts === 2（默认配置） |
| 传播可追溯 | skippedBy + propagation 链 |

## 测试工具（导出）

`ScriptedExecutor`：`{ script: Record<taskId, Array<'success'|
'failure'|'boom'>>, delayMs?, callLog, peakConcurrency }`——
按调用序出队脚本项（'boom' = 抛异常；耗尽重复末项），记录调用
序与并发峰值。M6 e2e 可复用。
