# Data Model: M10 Context Builder + Token Budget

**Date**: 2026-09-11 | **Spec**: [spec.md](../spec.md)

结构定义于 `packages/context/src/types.ts` 与
`packages/budget/src/types.ts`；契约见
[contracts/context-budget-api.md](contracts/context-budget-api.md)。

## 1. ContextSection

| 字段 | 类型 | 规则 |
|---|---|---|
| `kind` | `SECTION_KINDS` 闭集 | mission / taskGoal / findings / evidence / source / constraints / diff / validation / feedback / config |
| `source` | string | 来源引用（`task:<id>` / `mission` / `validation:<artId>` / `feedback`…） |
| `content` | string | 内容（unavailable 时空） |
| `sizeTokens` | number | 口径见 budget.estimate |
| `priority` | number | 压缩顺序（小先截） |
| `truncated` | boolean | 截断标注 |
| `unavailable` | boolean | 上游缺失标注（不伪造） |

## 2. ContextPackage

| 字段 | 类型 | 规则 |
|---|---|---|
| `taskId` / `role` | string | 归属 |
| `sections` | ContextSection[] | 角色规则产出（顺序确定） |
| `totalTokens` | number | Σ sizeTokens |
| `budget` | `{ limit, level: 'task'\|'mission'\|null }` | 生效预算（null = 不强制） |
| `compressions` | number | 已用压缩轮次（0..2） |
| `optimization` | `{ rawTokens, packedTokens, savedRatio }` | 原始材料 vs 装配后 |

## 3. BudgetRejection

`{ taskId, limit, level, rounds, sections: Array<{kind, sizeTokens,
truncated}> }`——Reject/Escalate 的结构化载体（任务失败
retryable=false，明细供人工）。

## 4. UsageRecord（Agent 级）

| 字段 | 类型 | 规则 |
|---|---|---|
| `runId` / `taskId` / `role` | string | 执行关联 |
| `inputTokens` / `outputTokens` / `cachedTokens` | number | 运行时报告（未测 = 0） |
| `durationMs` | number | 实测 |
| `contextSize` | number | 装配产物估算（口径函数复算一致） |
| `estimatedCost` | number | 单价表缺省全 0 |
| `measured` | boolean | usage 缺失 = false（不伪造） |

## 5. BudgetSummary（Task / Mission 级）

Task：`{ taskId, executions: UsageRecord[], sums, optimization? }`；
Mission：`{ tasks: TaskSummary[], sums, optimization: 汇总
（rawTokens/packedTokens/savedRatio） }`。聚合 = 纯加法（卫生后
字段）。

## 6. 角色规则表（单一事实源）

| 角色 | sections（priority 升序 = 压缩先截序） |
|---|---|
| reflex | findings(1) 装配外不可得——实际仅 mission(9) / taskGoal(10) / feedback(8) |
| focus | source(3) / findings(4) / mission(9) / taskGoal(10) / feedback(8) |
| reason | source(2) / evidence(3) / findings(4) / constraints(5) / feedback(8) / mission(9) / taskGoal(10) |
| insight | config(2) / source(3) / diff(4) / validation(5) / feedback(8) / mission(9) / taskGoal(10) |
| wisdom | diff(3) / findings(4) / validation(5) / feedback(8) / mission(9) / taskGoal(10) |

resolver 闭集：mission / taskGoal / constraints（mission+task 约束
渲染）/ feedback（执行参数）/ registry 上游产物（findings =
focus 输出、evidence = insight 输出，按 dependsOn）/ suppliers
（diff、validation、source、config——由 gate/executor 注入）。

## 7. 状态机（装配）

```text
resolve 规则 → 逐 section 取数（unavailable 标注）
 → totalTokens ≤ budget? ──是──→ ContextPackage（compressions=0）
      │否（budget ≠ null）
      ▼
 压缩轮 1..2：priority 升序截（头尾 ~25% + marker）→ 复检
      ├── 合规 → ContextPackage（compressions=n，truncated 标注）
      └── 轮次耗尽仍超 → BudgetRejection（executor → 任务失败 retryable=false）
budget = null → 不压缩不报错（只测量）
```

## 8. RunReport.budget（duck-typing 合成）

```ts
budget?: {
  mission: { sums, optimization };
  tasks: Array<{ taskId, sums, executions: UsageRecord[] }>;
}
```
