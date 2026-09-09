# Data Model: M0 Foundation

**Date**: 2026-09-09 | **Spec**: [spec.md](spec.md)

所有实体的 Schema 以 Zod 定义于 `packages/core`，为本文件的唯一实现
真源；本文件描述字段、校验规则与关系。

## 1. FleetConfiguration

仓库级配置，来源 `configs/fleet.yaml`（位置约定见 research.md D5）。

| 字段 | 类型 | 必填 | 规则 |
|---|---|---|---|
| `version` | integer | 是 | 配置格式版本；M0 仅接受 `1` |
| `repository` | string | 否 | 目标仓库路径；缺省 = 当前仓库根 |
| `defaults.maxConcurrency` | integer | 否 | 默认 `3`；1–64 |
| `defaults.retry` | integer | 否 | 默认 `1`；0–10 |
| `defaults.budget` | object | 否 | 占位字段组（token/时长上限），M0 仅存储不解释 |

**校验规则**（FR-007）：

- 未知字段拒绝（strict），错误信息逐字段列出：`path.to.field` +
  期望 + 实际。
- 空文件 / 空 YAML 对象：报"配置为空"错误。
- 数值越界（如 `maxConcurrency: 0`）：逐字段报错。

## 2. DiagnosticReport

`fleet doctor` 的输出实体，同时驱动人类可读渲染与 `--json` 序列化
（FR-011）。

| 字段 | 类型 | 说明 |
|---|---|---|
| `ready` | boolean | 全部检查无 error 即 true（warning 不影响） |
| `summary` | string | 一行结论，如 "环境就绪" / "2 项错误需修复" |
| `checks` | CheckItem[] | 检查项列表，固定顺序见契约 |
| `durationMs` | integer | 诊断耗时（对应 SC-002 ≤ 5000） |

**CheckItem**:

| 字段 | 类型 | 规则 |
|---|---|---|
| `id` | string | 稳定标识（如 `node-version`、`git-repo`、`codegraph`） |
| `label` | string | 人类可读名称 |
| `status` | enum | `ok` / `warning` / `error` |
| `detail` | string | 结果说明（版本号、路径、原因） |
| `fixSuggestion` | string? | status ≠ ok 时必填，可执行建议 |

**关系**: `ready = checks.every(c => c.status !== "error")`。

## 3. FleetEvent

结构化事件（FR-006 / 宪法"事件 MUST 全程记录"的接口先行）。M0 仅
定义 schema 与 JSON 可序列化，不持久化（M11 范围）。

| 字段 | 类型 | 规则 |
|---|---|---|
| `id` | string | `evt_` 前缀 + randomUUID（research.md D6） |
| `type` | string | 点分命名，M0 使用 `doctor.*` 命名空间 |
| `timestamp` | string | ISO 8601 |
| `payload` | object | 按 type 约定；M0 为 DiagnosticReport 摘要 |

## 4. FleetError

统一错误模型，所有 core 能力抛出的唯一错误类型。

| 字段 | 类型 | 规则 |
|---|---|---|
| `code` | string | 稳定错误码（如 `CONFIG_INVALID`、`NOT_A_GIT_REPO`） |
| `category` | enum | `config` / `environment` / `internal` |
| `message` | string | 用户可读信息 |
| `context` | object | 结构化上下文（字段路径、期望/实际值） |
| `cause` | Error? | 原始异常，禁止吞栈 |

**规则**: 配置校验失败时 `context.issues` 为逐字段问题数组
（path / expected / received / message），与 FR-007 对应。

## 生命周期 / 状态转换

M0 无持久化状态机。doctor 检查为固定顺序的无状态流水：
runtime 版本 → git 可用 → 仓库识别 → 配置加载校验 →（warning 级）
CodeGraph 探测 →（warning 级）Agent Runtime 探测；不 fail-fast，
全部执行后汇总（research.md 探测语义）。

## 实体关系总览

```text
configs/fleet.yaml ──加载/校验──▶ FleetConfiguration
                                        │
FleetError ◀──失败路径──────────────────┘

doctor 检查流水 ──▶ CheckItem[] ──▶ DiagnosticReport ──▶ 人类可读 / JSON
                                            │
                                            ▼
                                      FleetEvent(doctor.completed)
```
