# Data Model: M3 Evidence System

**Date**: 2026-09-10 | **Spec**: [spec.md](spec.md)

所有结构以 Zod 定义于 `packages/repository/src/evidence/types.ts`
（新实体）与 `investigation/types.ts`（扩展）；CLI 输出形状见
[contracts/cli.md](contracts/cli.md)。规则表语义见
[research.md](research.md) D2/D3/D6。

## 1. Evidence（证据最小单元）

| 字段 | 类型 | 规则 |
|---|---|---|
| `source` | enum | `wiki / codegraph / search / source / config`（`lsp / compiler / test / runtime` 为枚举占位，本里程碑不产出） |
| `location` | string | source/config：`文件路径:行`；wiki：wiki 页面路径 |
| `excerpt` | string | ≤5 行片段（截断标注） |
| `verified` | boolean | 锚定复核结果：source/config 经 verifyAnchor 复核为 true；fast 模式加速源证据为 false；wiki = 页面存在于磁盘 |
| `symbol` | string? | 关联符号名（如有） |

**校验规则（FR-002 / SC-001）**: verified=true 的 source/config
证据 location 必须实际存在于磁盘；verified=true 的 wiki 证据页面
必须存在。锚定复核失败 → verified=false + confidence 降级
（FR-010）。

## 2. EvidenceConflict（位置/存在性级冲突）

| 字段 | 类型 | 规则 |
|---|---|---|
| `kind` | enum | `anchor_offset`（行号/范围偏移）/ `dead_path`（wiki 声称路径不存在） |
| `accelerated` | `{ source: wiki|codegraph, location, claim }` | 加速源陈述 |
| `truth` | `{ location, fact }` | Static Truth 事实 |
| `winner` | enum | 恒 `static_truth`（FR-007） |
| `reason` | string | 一句裁决原因（static_truth_wins 语义） |

## 3. Finding（结论单元）

| 字段 | 类型 | 规则 |
|---|---|---|
| `statement` | string | 确定性模板生成（research.md D1 四类），可读中文 |
| `kind` | enum | `symbol / file-cluster / wiki / insufficient` |
| `evidence` | Evidence[] | 1..10（上限截断标注 `truncated`）；insufficient finding 为空数组 |
| `confidence` | enum | `high / medium / low`（规则表 D6） |
| `confidenceReason` | string | 命中的规则说明（SC-003 可解释性） |
| `conflicts` | EvidenceConflict[] | 0..n |
| `truncated` | boolean? | evidence 超上限截断时 true |

## 4. ModeResolution（模式裁决）

| 字段 | 类型 | 规则 |
|---|---|---|
| `requestedMode` | enum | `auto / fast / verify`（CLI --mode，缺省 auto） |
| `effectiveMode` | enum | `fast / verify`（高风险与零命中升级后的实际模式，research.md D2/D3） |
| `escalations` | ModeEscalation[] | 升级记录：`{ rule: high_risk|zero_hits|accelerators_unavailable, detail }` |

## 5. InvestigationResult 扩展（向后兼容）

M1 全部字段（question / references / pathsUsed / fallbacks /
durationMs / summary / degraded / searchEngine）**原样保留**，
新增可选键：

| 字段 | 类型 | 规则 |
|---|---|---|
| `findings` | Finding[]? | M3 起恒有（旧版本消费者可忽略） |
| `mode` | ModeResolution? | 同上 |

FallbackReason.code 枚举追加：`wiki_missing / wiki_stale /
wiki_broken`（M1 九码兼容保留）。

## 6. 规则表（接口级实体）

- **HighRiskRule 表**（evidence/rules.ts）：输入
  `{ keywords, filePaths, snippets }` → 命中规则名列表。在 M1
  detectHighRisk（引用级）外新增模式级语义表：公共 API 增删 /
  Service / DB Schema（`schema|migrations`）/ Authentication
  （`auth|login|token|session`）/ Payment（`payment|billing|
  charge|invoice`）/ 大范围 Refactor（删除类动词 + 目录规模）。
- **ConfidenceRule 表**（evidence/confidence.ts）：输入
  `{ evidence[], conflicts[], mode }` →
  `{ confidence, reason }`。优先级：存在未决冲突或全部未复核 →
  low；fast 模式 → 封顶 medium；verified 多源一致 → high；其余
  → medium。

## 状态转换（investigate 流水，M3 版）

```text
plan → mode 裁决（auto/fast/verify + 高风险表）
  → [fast 路径] wiki 查询 → codegraph（不锚定，verified=false）
        ├─ 有命中 → findings（confidence ≤ medium）
        └─ 零命中/加速源不可用 → 升级 VERIFY（记录 escalation）
  → [verify 路径] wiki（fresh 才用）→ codegraph → verifyAnchor 锚定
        →（无引用时）search → source
        → config 重分类 → findings（confidence 最高 high）
  → 冲突检测（锚点偏移 / wiki 死路径）附到对应 finding
  → findings + mode 并入 InvestigationResult
```

无新持久化状态。事件 payload 扩展见 contracts/cli.md。

## 实体关系总览

```text
InvestigationPlan（M1 planner）
   → ModeResolution（rules 裁决）
   → 证据三路：wiki-source（M2 queryWiki）│ codegraph（M1 适配层）
              │ search+source（M1 回退链）→ config 重分类
   → resolver：证据分组 → Finding[]（模板 statement）
        ├─ confidence.ts：证据构成 → confidence + reason
        └─ 冲突检测 → EvidenceConflict[]（挂靠 finding）
   → InvestigationResult（M1 字段 + findings + mode）
```
