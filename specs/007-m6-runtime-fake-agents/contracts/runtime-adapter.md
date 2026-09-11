# Contract: RuntimeAdapter（M6）

**Date**: 2026-09-11 | **Spec**: [spec.md](../spec.md)

RuntimeAdapter 是 Agent Role 与具体运行时（宪法 IV）之间的唯一
接缝。M6 交付契约 + Fake 参考实现；真实 Adapter（Codex / Gemini /
Pi）属 M7，实现方必须遵守本契约的行为保证。

## 契约

```ts
interface RuntimeAdapter {
  execute(request: RuntimeRequest): Promise<RuntimeResult>;
  cancel(runId: string): Promise<void>;
}

interface RuntimeRequest {
  runId: string;        // run_ 前缀，每次执行唯一（重试 = 新 runId）
  agentId: string;      // agent:<taskId>（M6 语义）
  cwd: string;          // 目标仓库根
  prompt: string;       // 确定性模板（Context Builder 属 M10）
  env?: Record<string, string>;
  timeoutMs: number;    // ≥1；推导：task maxDurationMs > mission maxDurationMs > 5000
}

interface RuntimeResult {
  ok: boolean;
  code?: 'timeout' | 'cancelled' | 'error';  // ok=false 时必有
  detail?: string;
  output?: string;
}
```

## 实现方行为保证（合同条款）

| # | 保证 | 语义 |
|---|------|------|
| 1 | **异常不逃逸** | execute 内部捕获一切异常 → `{ok:false, code:'error', detail}` |
| 2 | **timeout 诚实** | 超过 timeoutMs 的执行 settle 为 timeout；**此后该执行的任何迟到结果被丢弃**（不二次 settle、不产生副作用） |
| 3 | **cancel 即时单次** | cancel(runId) 使在途执行毫秒级 settle 为 cancelled；其他执行不受影响；timeout 与 cancel 竞争先到先得，每 runId 恰一次 settle |
| 4 | **清理完备** | 任意结束路径（完成/失败/timeout/cancel）后无残留计时器与悬挂 promise——进程可干净退出 |

## FakeRuntimeAdapter（参考实现 / 测试底座）

- **角色延迟画像**（无脚本时）：reflex 15 / focus 30 / reason 45 /
  insight 30 / wisdom 60（ms）；`zeroDelays: true` 整体置零（CI）。
- **脚本化**：`script: Record<taskId, FakeStep[]>`（按调用序出队、
  耗尽重复末项）；`FakeStep = { outcome: 'success'|'failure'|
  'error'|'hang', delayMs?, output? }`——**hang 永不自行完成**
  （timeout / cancel 的注入形态）。
- **可观测面**（测试断言）：`inflightSize`（结束后 === 0）/
  `requests`（请求字段断言）/ `settleLog`（每 runId 单次）。

## 桥接（MissionRuntimeBridge，TaskExecutor 适配）

- `runId`：每次派发生成（`run_` + 短 uuid）；`agentId`：
  `agent:<taskId>`；`prompt`：`[任务 ${taskId}] ${task.goal}`；
  `cwd`：桥接配置；`timeoutMs`：任务级 > mission 级 > 默认 5000
  （整段透传，不做任务间均分——research.md D4）。
- 记录任务时间戳（TaskRun 合成原料）与全部请求（桥接测试载体）。

## RunReport（编排输出形态）

```json
{
  "run": { "id": "run_ab12…", "missionId": "demo-mission",
           "status": "completed", "startedAt": "…", "endedAt": "…",
           "taskRuns": [ { "taskId": "define-schema", "status": "completed",
                           "agentRole": "reason", "startedAt": "…", "endedAt": "…" } ] },
  "outcome": { "status": "completed", "nodes": [ /* M5 RunOutcome */ ],
               "dispatchOrder": ["define-schema", "wire-cli"],
               "propagation": [], "durationMs": 63 },
  "runtime": { "adapter": "fake", "perTaskTimeoutMs": { "wire-cli": 3600000 } }
}
```

构造后立即过 M4 `runSchema` 自校验。
