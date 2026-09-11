# Contract: fleet run（M6）

**Date**: 2026-09-11 | **Spec**: [spec.md](../spec.md)

退出码沿用全局契约：`0` mission completed（含 autonomous 无任务
的 note 态）；`1` mission failed / 文件或校验错误；`2` 用法错误。
Runtime 契约见 [runtime-adapter.md](runtime-adapter.md)。

## 命令

```bash
fleet run <path> [--json]
```

| 项 | 说明 |
|----|------|
| `<path>` | 必填。mission 文件路径（惯例 `missions/*.yaml`） |
| `--json` | 结构化 RunReport（含 M4 Run 实例） |

运行时固定 Fake（M6 唯一注册；真实 Adapter 属 M7）。

## 执行流水

```text
M4 校验（失败即拒绝、不执行任何任务）
  → M5 buildDag + Scheduler（maxConcurrency=3 / retry=1）
  → MissionRuntimeBridge → FakeRuntimeAdapter（五角色画像）
  → RunReport（Run + RunOutcome + runtime 元信息）
```

## JSON 输出（成功，退出码 0）

见 [runtime-adapter.md](runtime-adapter.md) 的 RunReport 样例；
autonomous 无任务时 `status: "completed"` + `note` 字段说明。

失败（退出码 1）：mission 校验失败 → M4
MissionValidationReport 形状；运行失败 → RunReport（status
failed + 传播链）。

## 文本输出（默认）

```text
▶ mission demo-mission（execution）· 2 任务 · fake 运行时
  任务表：
    define-schema  reason    completed  1 次  45ms
    wire-cli       reason    completed  1 次  46ms
✓ mission completed · 总耗时 63ms · runId run_ab12cd34
```

失败态：`✗ mission failed` + 失败任务行（attempts / failureReason）
+ skipped 行（→ 由谁传播）+ 传播链。

## 事件（stderr，不污染 --json stdout）

`mission.run.started`（runId / missionId）→
`mission.run.completed | mission.run.failed`（runId / status /
任务计数 / durationMs）。顺序保证：started 先、终态最后。

## 进程语义

run 结束后进程干净退出（无悬挂计时器——RuntimeAdapter 契约
保证 #4 的用户可见面）。
