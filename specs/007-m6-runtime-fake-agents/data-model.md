# Data Model: M6 RuntimeAdapter + Fake Agents

**Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

结构定义于 `packages/runtime/src/types.ts`；契约细节见
[contracts/runtime-adapter.md](contracts/runtime-adapter.md)。复用
实体：M4 Task/Run/TaskRun、M5 RunOutcome/TaskExecutor。

## 1. RuntimeRequest

| 字段 | 类型 | 必填 | 规则 |
|---|---|---|---|
| `runId` | string | 是 | `run_` 前缀 + 短 uuid；**每次执行**生成（重试 = 新 runId） |
| `agentId` | string | 是 | `agent:<taskId>`（M6 Fake 语义；真实 agent 实例属 M7） |
| `cwd` | string | 是 | 目标仓库根（桥接配置） |
| `prompt` | string | 是 | `[任务 ${taskId}] ${task.goal}`（确定性模板；Context Builder 属 M10） |
| `env` | Record<string, string> | 否 | M6 不设置 |
| `timeoutMs` | integer | 是 | ≥1；推导：task 级 maxDurationMs > mission 级 > 默认 5000（research.md D4 整段透传） |

## 2. RuntimeResult

| 字段 | 类型 | 规则 |
|---|---|---|
| `ok` | boolean | |
| `code` | enum? | 失败码：`timeout / cancelled / error`（ok=false 时必有） |
| `detail` | string? | 人话原因 |
| `output` | string? | Fake 模拟输出（脚本提供） |

## 3. RuntimeAdapter（契约）

```ts
interface RuntimeAdapter {
  execute(request: RuntimeRequest): Promise<RuntimeResult>;
  cancel(runId: string): Promise<void>;
}
```

- 实现方保证：execute **不让异常逃逸**（内部捕获 → error 码）；
  timeout 诚实（迟到结果丢弃）；cancel 单次 settle。
- M6 唯一实现：FakeRuntimeAdapter（真实 Adapter 属 M7）。

## 4. FakeStep（脚本化）

| 字段 | 类型 | 规则 |
|---|---|---|
| `outcome` | enum | `success / failure / error / hang`（hang = 永不自行完成——timeout/cancel 注入形态） |
| `delayMs` | integer? | 覆盖角色画像延迟 |
| `output` | string? | 模拟输出 |

脚本：`Record<taskId, FakeStep[]>`，按调用序出队、耗尽重复末项
（对齐 M5 ScriptedExecutor 心智）。角色画像（无脚本时）：
reflex 15 / focus 30 / reason 45 / insight 30 / wisdom 60（ms）；
`zeroDelays` 整体置零。

## 5. FakeRuntimeAdapter 内部（可观测面）

| 成员 | 类型 | 规则 |
|---|---|---|
| `inflightSize` | getter | 在途执行数（cleanup 断言：任意结束路径后 === 0） |
| `requests` | RuntimeRequest[] | 全部收到过的请求（桥接断言载体） |
| `settledCount` / `settleLog` | — | settle 次数与记录（单次 settle 断言：每 runId 恰一次） |

## 6. MissionRuntimeBridge（TaskExecutor → RuntimeAdapter）

- `implements TaskExecutor`（M5 端口）。
- 配置 `BridgeConfig`：`{ cwd, defaultTimeoutMs? = 5000 }`；
  timeoutMs 推导优先级见 §1。
- 记录：`taskTimings: Map<taskId, { startedAt, endedAt }>`（最后
  一次执行——TaskRun 合成原料）；`requests`（字段断言）。

## 7. RunReport

| 字段 | 类型 | 规则 |
|---|---|---|
| `run` | Run（M4） | id=首 runId、missionId、status、startedAt/endedAt、taskRuns[]（status=M5 终态；时间戳=最后执行） |
| `outcome` | RunOutcome（M5） | 派发序 / attempts / 传播链原样 |
| `runtime` | `{ adapter: 'fake', perTaskTimeoutMs: Record<string, number> }` | 推导依据可追溯 |
| `note` | string? | autonomous 无任务等说明（D8） |

构造后立即 `runSchema.parse` 自校验（SC-006 内建）。

## 状态转换（Fake 单次执行）

```text
execute(request):
  入 inflight{runId, settled:false, timers[]}
  三路竞争 → finish()（settled 守卫 + clearTimeout 全量 + 出表）：
    ① 脚本延迟到点 → success/failure/error（hang 不设此定时器）
    ② timeoutMs 到点 → {ok:false, code:'timeout'}
    ③ cancel(runId) → {ok:false, code:'cancelled'}
  先到先得，后到者被守卫吞掉（迟到成功丢弃，FR-004/005）
```

## 实体关系总览

```text
mission.yaml → runMissionFile（runtime/runner.ts）
   → M4 validateMissionFile（失败即拒）
   → M5 buildDag + Scheduler
        → MissionRuntimeBridge（TaskExecutor 适配）
             → FakeRuntimeAdapter.execute（画像/脚本/三路竞争）
   → RunReport（M4 Run + M5 RunOutcome + runtime 元信息）
   → 事件三枚（mission.run.started / completed | failed，stderr）
```
