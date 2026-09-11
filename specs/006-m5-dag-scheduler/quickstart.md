# Quickstart: M5 Task DAG + Scheduler 验证指南

**Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

库 API 契约见 [contracts/scheduler-api.md](contracts/scheduler-api.md)。
M5 无 CLI——验证 = 包内测试 + node 脚本演示。

## 前置条件

- M0–M4 基线可用（`pnpm check` 全绿）

## A. 拓扑矩阵（US1 / SC-001）

```bash
pnpm vitest run --project scheduler
```

**预期**（全部自动化断言）：

- linear（a→b→c）：dispatchOrder === [a, b, c]，全 completed
- parallel（3 独立）：三者同批派发，全 completed
- diamond（a→{b,c}→d）：b/c 在 a 后同批，d 在 b/c 后
- cycle（a→b→c→a）：构建拒绝，detail 含 `cycle: a -> b -> c -> a`
- missing / self：构建拒绝并定位 dependsOn
- failure：见 C 段

## B. 真实并发（US2 / SC-002 / SC-003）

自动化主证据：

- **SC-002**：3 个无依赖任务各延迟 120ms → 总耗时 < 300ms
  （串行基线 360ms）——真实并发的量化
- **SC-003**：5 就绪 + maxConcurrency=3 →
  `executor.peakConcurrency === 3` 且全程 ≤ 3（采样断言）

手工感受版（node 一行）：

```bash
node --input-type=module -e "
import { buildDag, Scheduler } from './packages/scheduler/dist/index.js';
import { ScriptedExecutor } from './packages/scheduler/dist/index.js';
const t = (id) => ({ id, goal: id, agentRole: 'reason', dependsOn: [] });
const started = Date.now();
const outcome = await new Scheduler().run(
  buildDag([t('a'), t('b'), t('c')]),
  new ScriptedExecutor({ script: { a: ['success'], b: ['success'], c: ['success'] }, delayMs: 120 }),
);
console.log('耗时', Date.now() - started, 'ms（串行基线 360）', outcome.status);
"
```

**预期**：耗时约 120–150ms、status = completed。

## C. 失败传播与终态（US3 / SC-004 / SC-005）

自动化断言（`pnpm vitest run --project scheduler` 内）：

- 必败任务：attempts === 2（retry=1）、终态 failed、执行器恰好
  被调 2 次
- 一败一成（脚本 ['failure','success']）：终态 completed，下游
  照常推进
- a→{b(必败),c}→d：b failed（2 次）、c completed、d skipped 且
  skippedBy=‘b’；run=failed；propagation 链完整
- 空 tasks：run=completed
- maxConcurrency=1：退化为串行（dispatchOrder 逐个），语义不变

## D. 确定性（SC-006）

自动化：同 DAG + 同 ScriptedExecutor 脚本双跑——dispatchOrder
与全部终态逐项一致。

## 完成判定

以上全部通过 = M5 验收（roadmap M5：**无依赖的任务能够真实
并发**；拓扑矩阵 7 类确定性通过或精确拒绝）。
