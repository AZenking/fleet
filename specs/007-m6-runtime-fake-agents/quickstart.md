# Quickstart: M6 RuntimeAdapter + Fake Agents 验证指南

**Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

命令契约见 [contracts/cli.md](contracts/cli.md)，Runtime 契约与
Fake 行为矩阵见 [contracts/runtime-adapter.md](contracts/runtime-adapter.md)。

## 前置条件

- M0–M5 基线可用（`pnpm check` 全绿）
- 仓库已有 `missions/demo.yaml`（M4 活样例）

## A. 端到端（US1 / SC-001，roadmap M6 验收锚点）

```bash
pnpm build
pnpm fleet run missions/demo.yaml            # 文本
pnpm fleet run missions/demo.yaml --json     # RunReport
```

**预期**：

- 退出码 0；文本模式任务表两行（define-schema → wire-cli 按依赖
  序）+ `✓ mission completed`；总耗时 < 1s（Fake 画像毫秒级）。
- `--json`：`run.id` 以 `run_` 开头、`run.taskRuns` 状态机合法
  （SC-006——报告构造时已过 runSchema，可再断言）；stderr 含
  `mission.run.started` 与 `mission.run.completed`。
- 重复运行：runId 不同（每次独立 run），任务结果一致。

## B. Runtime 行为矩阵（US2 / SC-002~005）

```bash
pnpm vitest run --project runtime
```

**预期**（全部自动化断言）：

| 项 | 断言 |
|---|------|
| timeout 诚实 | hang 任务 + timeoutMs=50 → 50ms 量级 settle timeout；延迟到点后**无第二个结果**（settleLog 单次） |
| cancel 即时 | hang + cancel → 毫秒级 cancelled；并行其他执行不受影响 |
| 竞争单次 settle | timeout 与 cancel 先到先得，每 runId 恰一次 |
| failure / error | 结构化失败码与 detail；异常不逃逸 |
| retry | 必败任务执行 2 次（M5 语义经桥接不变） |
| concurrency | 3 无依赖任务峰值并发 3（Fake 层 + runner 层双断言） |
| cleanup | 任意结束路径后 `inflightSize === 0`；e2e 子进程干净退出 |

## C. 失败 mission 与传播（US1 场景 3）

```bash
# tmp 夹具：必败任务 + 下游（e2e 内置同矩阵）
pnpm vitest run --project cli-e2e tests/cli/run.test.ts
```

**预期**：必败任务 attempts=2 后 failed → 退出码 1、`✗ mission
failed`、下游 skipped + 传播链行；`--json` 报告 status=failed。

## D. autonomous 无任务（US1 场景 4）

autonomous mission（只有 requirements）→ 退出码 0 + note
（"Reason 规划属 M7"）+ `mission.run.completed` 事件。

## E. 非法 mission 前置拒绝（US1 场景 2）

对 M4 故障矩阵任一文件跑 `fleet run` → 运行前拒绝（校验错误
逐条输出、退出码 1）且 Fake 的 requests 列表为空（未执行任何
任务——e2e 断言）。

## 完成判定

以上全部通过 = M6 验收（roadmap M6：`fleet run ./missions/demo.yaml`
完成 **Mission → DAG → Fake 五角色 → Complete**）——同时
**Fleet Kernel release gate（M4–M6）达成**。
