# Tasks: M10 Context Builder + Token Budget（角色化上下文与 Token 预算）

**Input**: Design documents from `/specs/011-m10-context-budget/`

**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/ ✅ quickstart.md ✅

**Tests**: 包含测试任务——SC-001 五角色矩阵 / SC-002 结构性排除 /
SC-003 三级聚合 / SC-004 预算阶梯 / SC-005 优化收益 / SC-006 M9
零回退 / SC-007 渲染兼容全部以自动化为验收证据。

**Organization**: 按 spec 用户故事分组（US1 Context Builder P1 /
US2 Token 记录与三级聚合 P2 / US3 预算强制与优化收益 P3）。实体 /
估算口径 / usage 通道放 Foundational——阻塞全部故事。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、无未完成依赖）
- **[Story]**: 所属用户故事
- 所有路径相对仓库根

---

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 初始化 `packages/context`（@fleet/context：core + mission + budget）与 `packages/budget`（@fleet/budget：core + mission）：package.json / tsconfig / tsup（对齐模板）/ 空 src/index.ts；vitest.config.ts 增 `context` 与 `budget` 两个 project

**Checkpoint**: 两包可构建、测试工程就位

---

## Phase 2: Foundational (Blocking Prerequisites)

- [x] T002 [P] `packages/budget`：types（UsageRecord/BudgetSummary/BudgetRejection/BudgetReport）+ estimate.ts（estimateTokens：ceil(chars/charsPerToken)，缺省 4；DEFAULT_PRICES 全 0；estimateCost）+ ledger.ts（BudgetLedger：record 卫生钳制（负/NaN/非整数丢弃字段并标注）+ snapshot 三级聚合（mission sums + optimization 汇总 / tasks[] 含 executions 明细））+ 单测（聚合算术含多执行同 task / 卫生矩阵 / 估算口径一致性）
- [x] T003 [P] `packages/runtime`：types.ts RuntimeResult 增可选 `usage?: { inputTokens; outputTokens; cachedTokens }`；fake.ts FakeStep 增 `usage?` 注入（成功 settle 时携带）；cli-adapter.ts 采纳 `FLEET_USAGE {...}` 标记行协议（输出含标记行才解析，否则 unmeasured）+ 单测（Fake 注入确定性 / CLI 解析与缺省）
- [x] T004 `packages/context/src/types.ts` + registry.ts：SECTION_KINDS 闭集、ContextSection/ContextPackage/BudgetRejection 实体、ROLE_CONTEXT_RULES 声明式规则表（data-model §6 优先级序）、RunArtifactRegistry（record 幂等覆盖 / outputsOf / findings / evidences）+ registry 单测

**⚠️ CRITICAL**: T002–T004 完成前不得开始用户故事

**Checkpoint**: 口径与通道就绪——装配可构建

---

## Phase 3: User Story 1 - Context Builder 按角色装配 (Priority: P1) 🎯 MVP

**Goal**: 五角色确定性装配 + 结构性排除 + DAG 上游注入（SC-001/002）

**Independent Test**: quickstart 场景 1——builder 矩阵单测

- [x] T005 [US1] `packages/context/src/builder.ts`：ContextBuilder.build（BuildInput → BuildResult）——按 ROLE_CONTEXT_RULES 逐 section 解析（mission/taskGoal/constraints/feedback 直取；findings/evidence 经 registry 按 task.dependsOn 直接上游映射（focus→findings、insight→evidence），缺失 unavailable=true 不伪造；source/diff/validation/config 经 suppliers 注入，缺供标注）；totalTokens = Σ sizeTokens（口径 budget.estimateTokens）；budget 解析（task.maxTokens ?? mission.maxTokens ?? null）——本任务先不做压缩（US3 接入），超限直接 rejection（占位语义）；optimization 统计（rawTokens = 压缩前材料和）
- [x] T006 [US1] `packages/context/src/render.ts`：render(pkg) 确定性文本——`[role · permission]` 首行 / `[任务 <id>] <goal>` 次行（**替身 CLI 解析逐字节兼容**）/ `## kind` 分节 / feedback 节 `[修复反馈]` 行 / unavailable 节标注行 + 单测（渲染快照：五角色样例 + 截断标注 + 修复反馈行 + `[任务 X]` 标记存在性）
- [x] T007 [US1] `packages/context/src/builder.test.ts`：五角色矩阵（reflex 仅 mission/taskGoal；reason 含 findings/evidence/source/constraints；focus 含 source/findings；insight 含 config/source/diff/validation；wisdom 含 diff/findings/validation）+ 上游缺失 unavailable + 直接上游优先 + 重试覆盖取最后一次 + SC-002 结构断言（SECTION_KINDS 闭集外无构造路径；全部 section source 非空）（依赖 T004、T005）

**Checkpoint**: US1 独立交付——装配矩阵成立

---

## Phase 4: User Story 2 - Token 记录与三级聚合 (Priority: P2)

**Goal**: 执行级记录 → 三级聚合进 RunReport（SC-003/SC-007）

**Independent Test**: quickstart 场景 2——executor 接缝单测 + e2e

- [x] T008 [US2] `packages/agents/src/executor.ts` 接缝：AgentExecutorConfig 增可选 `{ builder?: ContextBuilder; registry?: RunArtifactRegistry; ledger?: BudgetLedger }`（缺省回退 M7 手写模板——向后兼容层）；有 builder 时：build（rejection → `{ok:false, retryable:false, detail:超预算明细}`）→ render → prompt → 执行 → registry.record + ledger.record（UsageRecord：runtime usage 或 measured=false + 实测 durationMs + contextSize=pkg.totalTokens + estimatedCost）+ `budget` getter（ledger.snapshot）；`packages/agents/src/executor.test.ts` 增：注入路径 prompt=render 产物（含 `## mission` 分节）、rejection 终态、usage 回收、缺省路径回归（M7 模板不动）（依赖 T002、T005、T006）
- [x] T009 [US2] `packages/runtime/src/runner.ts`：ExecutorReportFace 增 `budget?` → RunReport 增可选 `budget`（duck-typing，三连模式）+ runner.test 增透传/缺省用例
- [x] T010 [US2] `apps/cli/src/commands/run.ts` 装配：buildExecutor 注入 builder/registry/ledger（reviewer 同 builder）；人类报告追加预算行（每任务 tokens + 节省比 + mission 汇总）；`--json` 自然含 budget

**Checkpoint**: 三级视图端到端可见

---

## Phase 5: User Story 3 - 预算强制与优化收益 (Priority: P3)

**Goal**: 压缩阶梯 + Reject/Escalate + 优化收益统计（SC-004/005/006）

**Independent Test**: quickstart 场景 3/4/5

- [x] T011 [US3] `packages/context/src/compress.ts`：compress(pkg, limit, rounds)——priority 升序截 section（头尾 ~25% + truncation marker + truncated=true），轮内逐级升压、复检；轮次耗尽仍超 → BudgetRejection（逐 section 尺寸明细 + rounds）；builder.build 接入（build → 超限 → compress ≤2 轮 → rejection）+ 单测（压缩合规/确定性复现/两轮上限/头尾保留 marker/maxTokens=1 必拒/无预算零压缩）（依赖 T005）
- [x] T012 [US3] `packages/validation/src/review.ts` 迁移：AgentReviewer 构造注入可选 builder（缺省内部构造 wisdom 规则等价装配：mission 摘要 + validation 摘要 + findings + diff 摘录 + priorFeedback）；渲染保留 M9 锚（`changes_requested` 格式说明 / 前轮意见 / 失败检查摘要行）；review.test 回归 + prompt 含 `## validation` 分节断言（依赖 T005、T006）
- [x] T013 [US3] e2e `tests/cli/budget.test.ts`：tmp git 仓库 + Fake usage 注入（`script: {a: [{outcome:'success', usage:{...}}]}`）——① 三级聚合（task.sums = 执行和、mission.sums = 任务和、含修复轮次双执行累计）；② contextSize > 0 且 measured 标注正确（未注入任务 measured=false）；③ 优化统计（rawTokens ≥ packedTokens、savedRatio ∈ (0,1]）；④ 预算阶梯 e2e（task 级 maxTokens + 大产物替身 → 压缩后 contextSize ≤ limit；maxTokens=1 → 任务失败 detail 含超预算、retryable 终态）；⑤ `[任务 <id>]` 渲染兼容（write-cli.sh 照常按 prompt 写 `<id>.txt`——M8/M9 语义不动）；⑥ `pnpm vitest run --project cli-e2e` 全量回归（M9 validation.test.ts 零回退 = SC-006）（依赖 T008、T010、T011）

**Checkpoint**: M10 验收锚点全绿——Token 可测量、Context 可控制

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T014 [P] 全量回归：`pnpm lint && pnpm format && pnpm build && pnpm test` 零失败；宪法对照复核（零 LLM 压缩 / 类型闭集排除全量 / 测量缺失不伪造）；README 仓库结构增 context/budget 两包 + M10 规格链接
- [x] T015 quickstart.md 走查（场景 1–5 可复现）；spec SC-001..007 逐条勾验；提交 milestone commit

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2**：两包骨架 → 口径/通道/实体（T002/T003/T004 可并行）
- **US1（T005–T007）** 依赖 T004；**US2（T008–T010）** 依赖 US1 + T002/T003；**US3（T011–T013）** 依赖 US2（T011 仅依赖 T005 可并行 T008）
- **Polish** 最后

### Parallel Opportunities

- T002 ∥ T003 ∥ T004；T006 ∥ T005 后半；T011 ∥ T008/T009/T010；T012 ∥ T011

## Implementation Strategy

- MVP = US1（装配矩阵）→ US2（测量可见）→ US3（强制与收益）→ Polish
- 每 Checkpoint 独立可验；M9/M8 回归是 US3 的硬门槛（SC-006）

## Notes

- 渲染兼容是隐形红线：任何 `[任务 <id>]` 标记变形都会击落 M8/M9 e2e——T006 的快照单测先行守门
- 压缩必须确定性（同输入同输出）——单测用固定种子材料
