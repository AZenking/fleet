# Data Model: M1 CodeGraph + Fallback

**Date**: 2026-09-09 | **Spec**: [spec.md](spec.md)

所有结构以 Zod 定义于 `packages/repository`；本文件描述字段、校验与
关系。与 codegraph CLI 实测输出（research.md）的字段映射在
[contracts/codegraph-adapter.md](contracts/codegraph-adapter.md)。

## 1. InvestigationRequest

| 字段 | 类型 | 必填 | 规则 |
|---|---|---|---|
| `question` | string | 是 | 非空；纯符号名或自然语言 |
| `repoRoot` | string | 是 | 绝对路径（由 --repo / 配置 / cwd 解析） |
| `scopePaths` | string[] | 否 | 路径提示（monorepo 子包收敛） |
| `includeGenerated` | boolean | 否 | 默认 false（排除产物目录） |

## 2. Reference（结果的最小证据单元）

| 字段 | 类型 | 规则 |
|---|---|---|
| `filePath` | string | 相对 repoRoot 的路径 |
| `startLine` / `endLine` | integer | ≥1；end ≥ start |
| `symbol` | string? | 符号名（codegraph 路径必有，纯文本命中可空） |
| `kind` | string? | 符号类别（function/class/method/...） |
| `snippet` | string | ≤5 行的代码片段（截断标注） |
| `origin` | enum | `codegraph` / `search` / `source` |
| `verified` | boolean | 是否已锚定源码（源码复核后为 true） |

**校验规则（FR-008 / SC-004）**: `origin=codegraph` 且 `verified=true`
的引用，其 filePath:startLine 必须实际存在于磁盘且行内容非空——
锚点校验是 source 模块的职责，冲突时以源码为准并记 conflict。

## 3. FallbackReason

| 字段 | 类型 | 规则 |
|---|---|---|
| `code` | enum | `unavailable / timeout / error / stale / missing_symbol / ambiguous / empty / conflict / high_risk` |
| `detail` | string | 一句可读原因（含关键证据，如同名符号列表） |

一条调查结果可含 0..n 条（SC-003：每次降级都可解释）。

## 4. InvestigationResult

| 字段 | 类型 | 规则 |
|---|---|---|
| `question` | string | 回显 |
| `references` | Reference[] | 去重（filePath+startLine+symbol）后按相关性排序 |
| `pathsUsed` | enum[] | 参与服务过的路径子集（`codegraph/search/source`） |
| `fallbacks` | FallbackReason[] | 全部降级记录 |
| `durationMs` | integer | ≥0 |
| `summary` | string | 一行结论（含"未找到相关内容"情形） |
| `degraded` | boolean | 任一降级发生即为 true |

## 5. CodeGraphAdapter（能力面，接口级实体）

方法（全部返回 `Result<T, CodeGraphFailure>` 形态，不抛异常）：

| 方法 | 入 | 出 |
|---|---|---|
| `health()` | — | `CodeGraphHealth` |
| `search(query, limit)` | 文本 | `SymbolHit[]` |
| `symbol(name)` | 符号名 | `SymbolHit[]`（同名全集） |
| `callers(symbol)` / `callees(symbol)` | 符号名 | `SymbolEdge[]` |
| `impact(symbol)` | 符号名 | `ImpactReport` |
| `explore(query)` | 文本 | 文本（原生文本能力，供上层展示） |

**CodeGraphFailure**（FR-004）: `{ code: unavailable/timeout/error/
stale, detail }`——与 FallbackReason 的 code 对齐（stale 由 health
判定后注入）。

**SymbolHit**: `{ name, qualifiedName?, kind, filePath, startLine,
endLine, language?, isExported? }`（映射 `query --json` 的 node）。

## 6. CodeGraphHealth

| 字段 | 类型 | 规则 |
|---|---|---|
| `available` | boolean | 命令存在且 status 可达 |
| `initialized` | boolean | |
| `version` | string? | |
| `indexFresh` | boolean | stale 判定取反（research.md D4） |
| `pendingChanges` | integer | added+modified+removed |
| `capabilities` | string[] | 实测可用的能力面 |

## 7. SearchHit

| 字段 | 类型 | 规则 |
|---|---|---|
| `filePath` | string | 相对路径 |
| `lineNumber` | integer | ≥1 |
| `lineText` | string | 命中行（trim） |
| `engine` | enum | `ripgrep / walk`（walk = 内置遍历降级） |

## 状态转换（investigate 流水的固定顺序）

```text
plan → health ─不可用/stale→ 记 FallbackReason → search
     └可用→ symbol/relations 查询
                ├─ 命中且 policy.validate 通过 → source 锚定复核 → 汇总
                └─ 缺失/歧义/空/冲突/高风险 → 记原因 → search → source → 汇总
```

无持久化状态；每次调查独立。事件（`repo.investigate.completed`）
经 core 事件结构走 stderr（与 doctor.completed 同模式）。

## 实体关系总览

```text
InvestigationRequest
   → planner 产出检索计划（内部）
   → CodeGraphAdapter / search / source 三源产出 Reference
   → policy 校验（escalate 产生 FallbackReason）
   → InvestigationResult（references + fallbacks + pathsUsed）
```
