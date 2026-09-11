# Tasks: M5 Task DAG + Scheduler（任务图与确定性调度）

**Input**: Design documents from `/specs/006-m5-dag-scheduler/`

**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/ ✅ quickstart.md ✅

**Tests**: 包含测试任务——SC-001 拓扑矩阵 / SC-002·003 并发量化 /
SC-004·005 重试传播 / SC-006 确定性全部以自动化为验收证据；
无 e2e（M5 无命令面）。

**Organization**: 按 spec 用户故事分组（US1 构建任务图与图校验
P1 / US2 确定性调度循环与真实并发 P2 / US3 失败传播与终态语义
P3）。共享地基（实体与端口、DAG 构建、配置、测试工具）放
Foundational——阻塞全部故事。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、无未完成依赖）
- **[Story]**: 所属用户故事
- 所有路径相对仓库根

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 分支与包骨架

- [x] T001 创建并切换实现分支 `006-m5-dag-scheduler`（从 main 切出）；初始化 `packages/scheduler` 包：package.json（@fleet/scheduler，依赖 @fleet/mission + zod）、tsconfig.json 继承 base、tsup 配置（对齐模板）、空 `src/index.ts`，纳入 vitest projects（更新根 `vitest.config.ts`）

**Checkpoint**: 包可构建、测试项目注册

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 实体端口、DAG、配置、测试工具——所有故事的地基

- [x] T002 定义实体与端口 `packages/scheduler/src/types.ts`：DagNode（taskId/task/status/attempts/failureReason?/skippedBy?）、SnapshotNode、TaskDag（接口面）、DispatchRecord、RunOutcome、TaskExecutor 端口（execute → {ok, detail?}）的类型与 Zod schema（status 沿用 M4 TaskRunStatus 枚举）
- [x] T003 实现 DAG `packages/scheduler/src/dag.ts`：buildDag（构建即校验——重复 id/悬空/自环 + **DFS 三色环检测报环链** `cycle: a -> b -> a`，错误 detail 精确定位，research.md D1/D2）；readyTasks（声明序过滤 pending ∧ 依赖全 completed）；snapshot()；counts()；dependents 正向边（依赖 T002）
- [x] T004 [P] 实现配置 `packages/scheduler/src/config.ts`：SchedulerConfig Zod schema + 构造校验（maxConcurrency int 1..64 默认 3；retry int 0..10 默认 1；非法域拒绝，research.md D7）
- [x] T005 [P] 实现测试工具 `packages/scheduler/src/test-kit.ts`：ScriptedExecutor（script: Record<taskId, Array<'success'|'failure'|'boom'>> 按调用序出队、耗尽重复末项；delayMs；callLog 调用序；peakConcurrency 并发峰值采样；'boom' = 抛异常，research.md D6）

**⚠️ CRITICAL**: T002–T005 完成前不得开始任何用户故事

**Checkpoint**: DAG 可构建可查询、执行器可脚本化——地基闭环

---

## Phase 3: User Story 1 - 构建任务图与图校验 (Priority: P1) 🎯 MVP

**Goal**: 拓扑矩阵 7 类中的图语义部分确定性通过或精确拒绝

**Independent Test**: quickstart A 段——linear/parallel/diamond 状态
链断言；cycle/missing/self 拒绝且环链精确

- [x] T006 [US1] DAG 单元测试 `packages/scheduler/src/dag.test.ts`：linear（a→b→c 就绪序逐个）、parallel（同批就绪）、diamond（b/c 在 a 后同时就绪、d 等待 b/c）、cycle（a→b→c→a 拒绝 + detail 含完整环链）、missing/self（拒绝 + dependsOn 定位）、重复 id（拒绝标双位置）、readyTasks 稳定序（同状态同结果）、手动推进状态后 readyTasks 正确刷新（依赖 T003）

**Checkpoint**: US1 独立交付——图语义 MVP 成立（M4 留下的环检测落点）

---

## Phase 4: User Story 2 - 确定性调度循环与真实并发 (Priority: P2)

**Goal**: 调度循环（决策串行 + 执行并发）；真实并发量化

**Independent Test**: quickstart B 段——3×120ms 总耗时 < 300ms；
5 就绪 + 上限 3 → peak === 3

- [x] T007 [US2] 实现调度循环 `packages/scheduler/src/scheduler.ts`：run(dag, executor) 循环——propagateFailures（不动点）→ readyTasks 派发（slice 到剩余额度，Promise 并发 + race 收结果，settle 永不 reject）→ 重试语义（attempts ≤ retry 回 pending，否则 failed）→ 收敛计算 RunOutcome（status 三态判定 / nodes 快照 / dispatchOrder / propagation / durationMs，research.md D4/D5）；执行器异常等价失败；出口导出（依赖 T003、T004）
- [x] T008 [US2] 并发测试 `packages/scheduler/src/scheduler.test.ts`（并发组）：SC-002——3 无依赖 120ms 任务总耗时 < 300ms 且全部 completed；SC-003——5 就绪 + maxConcurrency=3 → peakConcurrency === 3 且 dispatchOrder 前批恰 3 个；maxConcurrency=1 退化串行（逐个派发语义不变）；配置边界（0/负数拒绝）（依赖 T007）

**Checkpoint**: roadmap M5 验收锚点落地——无依赖任务真实并发

---

## Phase 5: User Story 3 - 失败传播与终态语义 (Priority: P3)

**Goal**: 固定重试、传播可追溯、终态三态矩阵

**Independent Test**: quickstart C/D 段——必败恰执行 2 次；传播链
完整；双跑派发序列一致

- [x] T009 [US3] 失败/传播测试 `packages/scheduler/src/scheduler.test.ts`（失败组）：必败任务 attempts === 2 + 终态 failed + 执行器恰调 2 次（SC-004）；一败一成（['failure','success']）→ completed 下游照常；a→{b 必败, c}→d 传播——d skipped + skippedBy=b + propagation 链（SC-005）；终态三态（全 completed / 含 failed / 空 DAG → completed）；执行器抛异常等价失败不击穿（依赖 T007）
- [x] T010 [US3] 确定性测试 `packages/scheduler/src/scheduler.test.ts`（确定性组）：同 DAG + 同脚本双跑——dispatchOrder 与全部终态逐项一致（SC-006）；混合场景（并发 + 失败 + 重试 + 传播）双跑一致（依赖 T009）

**Checkpoint**: Fleet Kernel 调度语义闭环——M6 RuntimeAdapter 可直接适配

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T011 [P] 更新根 `README.md`：进度更新至 M5（Fleet Kernel 调度层），仓库结构补 packages/scheduler；M5 规格/验证手册链接
- [x] T012 按 quickstart.md 走查并记录（A 拓扑矩阵 / B 并发 node 演示 / C 传播 / D 确定性）；问题回流修复后 `pnpm check` 全绿并按逻辑组提交 git

---

## Dependencies

### Phase Completion Order

- **Setup (Phase 1)** → **Foundational (Phase 2)** → 阻塞全部故事
- **US1 (Phase 3)**：只依赖 T003（DAG）；不依赖 US2/US3
- **US2 (Phase 4)**：依赖 T002–T005（循环是 US2 的实现故事）
- **US3 (Phase 5)**：依赖 T007（传播逻辑在循环内）；测试扩展同文件（T008→T009→T010 顺序执行）
- **Polish (Phase 6)**：依赖全部故事完成

### Within Each User Story

- Foundational：types（T002）→ dag（T003）；config/test-kit（T004/T005）并行
- US2：scheduler.ts（T007）一次完整实现（循环含重试与传播，避免同文件拆分）→ 并发测试（T008）
- US3：纯测试扩展（T009/T010），无新实现

### Parallel Opportunities

- Phase 2: T004/T005 与 T003 并行（T002 之后）
- 单人开发按 P1→P2→P3 顺序推进即可

---

## Parallel Example: Phase 2

```bash
# T002 完成后，三个不同文件可同时启动：
Task: "DAG 构建 packages/scheduler/src/dag.ts"
Task: "配置 packages/scheduler/src/config.ts"
Task: "测试工具 packages/scheduler/src/test-kit.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + Phase 2 → 地基就绪
2. Phase 3（US1）→ 图语义全绿
3. **STOP and VALIDATE**: 拓扑矩阵通过（T006）后即为可演示 MVP

### Incremental Delivery

1. US1 → DAG 与图校验（MVP）
2. US2 → 调度循环 + 真实并发（验收锚点）
3. US3 → 重试/传播/终态（Kernel 语义闭环）
4. Polish → README + 走查，M5 验收关闭

---

## Notes

- [P] = 不同文件且无未完成依赖
- 每完成一个任务或逻辑组做一次 git commit（分支 006-m5-dag-scheduler）
- 停在任一 Checkpoint 均可独立验证该故事
- 宪法红线（V）：Rule-based、Static DAG、固定 retry=1/并发=3、无 LLM/动态重排/Agent 协商；端口无 timeout/cancel（M6 RuntimeAdapter 契约，提前定会被推翻）；无 CLI（fleet run 属 M6）、无持久化（M11）；零新增依赖
- 并发测试时序断言阈值放宽（<300ms）防慢机抖动，峰值采样为主证据
- 避免：模糊任务、同文件冲突（scheduler.test.ts 的 T008/T009/T010 顺序执行）、跨故事依赖破坏独立性
