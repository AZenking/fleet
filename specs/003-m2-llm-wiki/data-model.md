# Data Model: M2 LLM Wiki

**Date**: 2026-09-10 | **Spec**: [spec.md](spec.md)

所有结构以 Zod 定义于 `packages/repository/src/wiki/types.ts`；磁盘
格式（front matter / 围栏 / index）的字段映射见
[contracts/wiki-format.md](contracts/wiki-format.md)。origin 与 scope
语义见 [research.md](research.md) D2/D3。

## 1. WikiMetadata（front matter 的 schema）

| 字段 | 类型 | 必填 | 规则 |
|---|---|---|---|
| `title` | string | 是 | 非空；index 导航显示名 |
| `generated_from` | string | 否 | 7–40 位 hex git sha；缺失 = 不可锚定（非 git 仓库，页面显式渲染 missing，FR-002） |
| `updated_at` | string | 是 | ISO 8601 时间戳 |
| `scope` | string[] | 是 | 非空；仓库相对路径前缀（`.` = 全仓库）；参与 stale 判定与增量更新（FR-007/008） |

`origin` 不落盘——由围栏结构运行时推导（research.md D2），避免
双源事实。

## 2. WikiPage（内存实体）

| 字段 | 类型 | 规则 |
|---|---|---|
| `path` | string | 相对 wiki 根（如 `domains/core.md`） |
| `section` | enum | `index / architecture / domains / infrastructure / decisions / glossary` |
| `metadata` | WikiMetadata | |
| `generatedBlocks` | string[] | 围栏内内容（0..n 段） |
| `manualContent` | string | 围栏外正文（可为空） |
| `origin` | enum | `generated / manual / mixed`（推导值） |

**校验规则（FR-004）**: generatedBlocks 内的路径 token 与全文档
markdown 链接必须锚定磁盘真实文件；违规进 ValidationReport，不中断
其余页校验。

## 3. WikiStatus（status 命令输出）

| 字段 | 类型 | 规则 |
|---|---|---|
| `exists` | boolean | wiki 根目录与 index 是否存在 |
| `state` | enum | `fresh / stale / unknown`（unknown = generated_from 缺失或非 git 仓库） |
| `headSha` | string? | 当前 HEAD；非 git 仓库为空 |
| `generatedFrom` | string? | 各页 generated_from 的最新值（页面级差异见 pages） |
| `aheadCommits` | integer? | generated_from..HEAD 的提交数 |
| `changedFiles` | string[] | diff --name-only 结果 |
| `pages` | PageFreshness[] | 页面级明细 |
| `fullRebuildRecommended` | boolean | 受影响页面占比 > 70%（research.md D4） |

**PageFreshness**: `{ path, origin, stale, matchedScope[] }`——
`stale ⇔ changedFiles ∩ scope ≠ ∅`（SC-004 纯集合运算）。

## 4. BuildResult / UpdateResult

| 字段 | 类型 | 规则 |
|---|---|---|
| `pagesWritten` | string[] | 本次写入的页面路径 |
| `pagesUnchanged` | string[] | 内容与元数据均未变（build 幂等重跑） |
| `pagesSkipped` | string[] | update 跳过的 manual 页（附人工更新提示） |
| `validation` | ValidationReport | 写入后立即校验的结果 |
| `backups` | string[] | mixed 页重写前的原文件备份路径（.fleet/wiki/.backup/，滚动保留最近一代） |
| `durationMs` | integer | ≥0 |

SC-003 断言载体：update 后 `pagesWritten` = status 标记 stale 的
generated/mixed 页全集，`pagesUnchanged ∪ pagesSkipped` = 其余全集。

## 5. ValidationReport

| 字段 | 类型 | 规则 |
|---|---|---|
| `ok` | boolean | errors 为空 |
| `errors` | ValidationError[] | 结构化错误清单 |

**ValidationError**: `{ code, detail, pagePath }`；code ∈
`missing_index / missing_section / bad_frontmatter / bad_metadata /
unpaired_fence / dead_reference / dead_link / index_out_of_sync`
（FR-004 / spec edge case"手工破坏"）。

## 6. WikiQueryResult

| 字段 | 类型 | 规则 |
|---|---|---|
| `question` | string | 回显 |
| `hits` | WikiHit[] | 按分数降序、同分按 path 字典序（全确定性） |
| `suggestions` | string[] | 空结果时的主题建议（index 页面标题全集） |
| `engine` | enum | `ripgrep / walk`（沿用 SearchOutcome） |
| `durationMs` | integer | ≥0 |

**WikiHit**: `{ pagePath, section, title, snippet, score,
scoreBreakdown }`；`score = 标题命中×3 + 小节标题命中×2 + 正文命中
行数×1`，scoreBreakdown 三元组供解释（research.md D6）。

## 状态转换（wiki 生命周期）

```text
(不存在) --init--> (骨架) --build--> (populated)
    populated --status--> fresh | stale | unknown
    stale --update--> fresh'（仅受影响 generated/mixed 页）
    任意状态 --query--> 只读（missing/broken → 报错退出 1；stale → 警告 + 结果）
    任意状态 --build--> 全量重算（幂等：未变页面 pagesUnchanged）
```

无跨命令内存状态；磁盘 front matter 是唯一持久事实。事件
（`wiki.<cmd>.completed`）经 core 事件结构走 stderr（与
repo.investigate.completed 同模式）。

## 实体关系总览

```text
WikiMetadata（front matter）──┐
                              ├→ WikiPage ──┬→ index.md（导航层，由页面清单生成）
generated 围栏（磁盘格式）────┘             │
                                            ├→ status: changedFiles × scope → PageFreshness
                                            ├→ validator: 页面 × 磁盘 → ValidationReport
                                            └→ query: 关键词 × wiki 全文 → WikiHit
```
