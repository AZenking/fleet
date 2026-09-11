# Quickstart: M10 Context Builder + Token Budget 验证指南

**Spec**: [spec.md](../spec.md) | **Contract**: [contracts/context-budget-api.md](contracts/context-budget-api.md)

## 前置

```bash
pnpm build && pnpm test
```

## 场景 1 — 角色化装配（SC-001/SC-002，库级）

五角色任务各一（mission 含 focus 上游与 findings 产物注入
registry）：`builder.build(...)` 断言——

- reflex sections 仅 mission/taskGoal（feedback 缺省）
- reason 含 findings/evidence/source/constraints
- wisdom 含 validation/diff/findings
- 全部 section source 非空；注入闭集外 kind 无构造路径

## 场景 2 — 三级聚合（SC-003，e2e）

tmp git 仓库 + Fake（脚本化 usage 注入）+ `fleet run --json`：

```bash
fleet run mission.yaml --json | jq .budget
```

**预期**：task.sums = executions 之和；mission.sums = tasks 之和；
contextSize > 0；未注入 usage 的执行 measured=false。

## 场景 3 — 预算阶梯（SC-004，库级）

- 大 findings + task 级 maxTokens：装配后 totalTokens ≤ limit、
  低优先级 section truncated、compressions ≥ 1
- maxTokens=1：BudgetRejection（rounds=2、逐 section 明细）→
  executor 返回 retryable=false
- 无约束：零压缩零报错

## 场景 4 — 优化收益（SC-005）

任意成功装配：optimization.rawTokens > packedTokens（材料多于
装配面）、savedRatio ∈ (0,1]；mission 级汇总在 report.budget。

## 场景 5 — M9 回归（SC-006/SC-007）

`pnpm vitest run --project cli-e2e`——M9 validation.test.ts 全绿
（审阅上下文迁移零回退）；M8 e2e 全绿（`[任务 <id>]` 渲染兼容）。

## 成功判据（对齐 spec SC-001..007）

- [ ] 五角色装配矩阵 100% 命中
- [ ] 全量倾倒结构性排除
- [ ] 三级聚合含重试/修复轮次正确
- [ ] 压缩合规 / Reject 终态 / 无预算直通三路径
- [ ] 优化收益三段统计
- [ ] M9/M8 回归全绿
- [ ] 派发请求 100% 结构化 Context 渲染
