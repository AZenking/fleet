# Contract: fleet CLI（M0）

**Date**: 2026-09-09 | **Spec**: [spec.md](spec.md)

M0 暴露两条命令。所有输出 UTF-8；退出码全局约定一致（FR-011）。

## 退出码（全局）

| Code | 含义 |
|------|------|
| 0 | 成功；对 doctor 而言 = 无 error 项 |
| 1 | 运行失败；对 doctor 而言 = 存在 error 检查项 |
| 2 | 用法错误（未知命令/参数） |

## fleet --version

打印 CLI 版本号（单一行，语义化版本），退出码 0（FR-009）。

## fleet doctor

环境诊断（FR-003 / FR-004 / FR-005 / FR-011）。

**参数**:

| 参数 | 说明 |
|------|------|
| `--json` | 输出结构化 DiagnosticReport；省略时输出人类可读文本 |

**检查项与固定顺序**（id / 级别语义）:

| # | id | error 级失败条件 |
|---|----|------------------|
| 1 | `node-version` | process.version 不满足 engines.node |
| 2 | `git-available` | git 命令不存在或不可执行 |
| 3 | `git-repo` | 自 cwd 向上未找到 .git |
| 4 | `fleet-config` | configs/fleet.yaml 缺失 / 为空 / 校验失败 |
| 5 | `codegraph` | （warning 级）codegraph 命令不存在 |
| 6 | `agent-runtimes` | （warning 级）codex / claude / gemini / pi 均不存在 |

规则：

- 不 fail-fast，六项全部执行后汇总（research.md）。
- #5 / #6 任何失败只产生 warning，绝不影响 `ready`（宪法原则 I）。
- #6 只要探测到任一 runtime 即 ok，detail 列出全部已发现项。
- 任何检查项自身崩溃/超时：该项降级为 warning 或 error（按级别语义）
  并附原因，doctor 进程不得崩溃或挂起（spec 边界情况）。

**JSON 输出**（`--json`）: DiagnosticReport 的直接序列化（见
[data-model.md](../data-model.md) §2），单行或多行 JSON 均可，但字段
与顺序稳定；退出码与文本模式一致。

**人类可读输出**（默认）: 每个检查项一行，状态用符号标识
（✓ / ⚠ / ✗），error/warning 行后缩进附 detail 与修复建议；末尾一行
summary 与"环境就绪"或待修复项计数。

示例（文本模式）：

```text
✓ node-version        v24.11.0 (满足 >=24)
✓ git-available       git 2.47
✓ git-repo            /path/to/agent-fleet
✓ fleet-config        configs/fleet.yaml
⚠ codegraph           未安装 — 可降级，不影响 Fleet 可用
⚠ agent-runtimes      未发现 codex/claude/gemini/pi — M7 前无需安装
──────────────────────────────────────
环境就绪（2 项警告）
```
