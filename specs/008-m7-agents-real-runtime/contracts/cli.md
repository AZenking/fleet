# Contract: fleet run --runtime（M7）

**Date**: 2026-09-11 | **Spec**: [spec.md](../spec.md)

退出码沿用全局契约（0 completed / 1 failed·错误 / 2 用法）。

## 命令

```bash
fleet run <path> [--runtime <spec>]... [--json]
```

| 项 | 说明 |
|----|------|
| `--runtime fake` | 全部角色用 Fake（**缺省行为**，M6 兼容） |
| `--runtime pi` | 全部角色用指定运行时（codex / gemini / pi / 自定义命令名） |
| `--runtime reason=pi` | 单角色覆盖（可重复：`--runtime reason=pi --runtime focus=fake`） |
| `--json` | RunReport（请求流含 role→runtime→permission 可追溯） |

**不可用即报错**：显式指定的运行时探测失败 → 启动前退出码 1，
输出探测结果与安装建议——**不静默降级 Fake**。

## 文本输出（运行时信息行）

```text
▶ mission demo-mission · 2 任务 · 运行时 reason=pi 其余=fake
  任务表：
    analyze    focus     completed  1 次  [pi · READ_ONLY]
    build      reason    completed  1 次  [pi · DEEP_WRITE]
✓ mission completed · …
```

## 事件

`mission.run.started` payload 增 `runtimes`（role→名义映射）；
其余事件形态不变（stderr，顺序保证）。

## doctor 联动

`fleet doctor` 的 Agent Runtime 检查项消费同一探测源
（probeRuntime）：codex / gemini / pi 逐项列出可用性与版本
（warning 级——缺失只提示，不阻断；宪法 I 精神同 CodeGraph）。
