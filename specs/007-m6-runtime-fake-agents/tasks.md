# Tasks: M6 RuntimeAdapter + Fake Agents（运行时契约与 Fake 执行端到端）

**Input**: Design documents from `/specs/007-m6-runtime-fake-agents/`

**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/ ✅ quickstart.md ✅

**Tests**: 包含测试任务——roadmap 必测六项（timeout / cancel /
failure / retry / concurrency / process cleanup）与 SC-001/006
全部以自动化为验收证据（FR-011，e2e 以 Fake 为准）。

**Organization**: 按 spec 用户故事分组（US1 fleet run 端到端 P1 /
US2 Runtime 契约与 Fake 行为矩阵 P2 / US3 桥接与 Run 记录 P3）。
契约与 Fake 实现放 Foundational——阻塞全部故事。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、无未完成依赖）
- **[Story]**: 所属用户故事
- 所有路径相对仓库根

---

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 创建并切换实现分支 `007-m6-runtime-fake-agents`（从 main 切出）；初始化 `packages/runtime` 包：package.json（@fleet/runtime，依赖 @fleet/mission + @fleet/scheduler + @fleet/core）、tsconfig / tsup（对齐模板）、空 `src/index.ts`，纳入 vitest projects（更新根 `vitest.config.ts`）

**Checkpoint**: 包可构建、测试项目注册

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Runtime 契约与 Fake 参考实现——所有故事的地基

- [x] T002 定义契约与实体 `packages/runtime/src/types.ts`：RuntimeRequest（runId/agentId/cwd/prompt/env?/timeoutMs ≥1）、RuntimeResult（ok/code: timeout|cancelled|error/detail/output）、RuntimeAdapter 契约（execute + cancel + 行为保证注释）、FakeStep（outcome: success|failure|error|hang + delayMs? + output?）、角色延迟画像常量（reflex 15/focus 30/reason 45/insight 30/wisdom 60ms，research.md D3）（对齐 data-model.md §1–§5）
- [x] T003 实现 FakeRuntimeAdapter `packages/runtime/src/fake.ts`：三路竞争（脚本延迟/timeout/cancel）汇入唯一 finish()——settled 单次守卫 + clearTimeout 全量 + inflight 出表（迟到结果丢弃，FR-004/005）；脚本按 taskId 出队（耗尽重复末项）+ hang 不设延迟定时器；zeroDelays 模式；可观测面 inflightSize / requests / settleLog（每 runId 单次）（research.md D2/D3）（依赖 T002）

**⚠️ CRITICAL**: T002–T003 完成前不得开始任何用户故事

**Checkpoint**: Fake 可脚本化驱动——契约行为保证就位

---

## Phase 3: User Story 1 - fleet run 端到端 (Priority: P1) 🎯 MVP

**Goal**: `fleet run missions/demo.yaml` → Mission → DAG → Fake
五角色 → Complete（roadmap M6 验收锚点）

**Independent Test**: quickstart A 段——退出码 0、任务表两行按依赖
序、`✓ mission completed`、事件两枚、报告过 runSchema（SC-001/006）

- [x] T004 [US1] 实现桥接 `packages/runtime/src/bridge.ts`：MissionRuntimeBridge implements TaskExecutor——runId 每次执行生成（run_ 前缀）、agentId=`agent:<taskId>`、prompt=`[任务 ${taskId}] ${goal}`、cwd 来自配置、timeoutMs 推导（task maxDurationMs > mission maxDurationMs > 默认 5000，整段透传）；记录 taskTimings（最后执行时间戳）与全部 requests（research.md D5）（依赖 T003）
- [x] T005 [US1] 实现编排 `packages/runtime/src/runner.ts`：runMissionFile(path, options)——M4 校验前置（失败即拒、零执行）→ M5 buildDag + Scheduler → bridge + Fake → RunReport 合成（M4 Run 实例 + M5 RunOutcome + runtime.perTaskTimeoutMs，构造后 runSchema.parse 自校验）→ 事件三枚（mission.run.started / completed | failed，stderr，顺序保证）；autonomous 无任务 → completed + note（D8）；返回统一结果形态供 CLI 映射退出码（依赖 T004）
- [x] T006 [US1] 注册 CLI `apps/cli/src/commands/run.ts` + `bin.ts` 接线：`fleet run <path> [--json]`——文本模式任务表（id/角色/状态/次数/耗时）+ 终态行 + 传播链；--json 输出 RunReport；退出码 0/1/2（对齐 contracts/cli.md）
- [x] T007 [US1] e2e `tests/cli/run.test.ts`：demo.yaml → 退出码 0 + completed + 任务依赖序 + stderr 事件两枚 + `--json` 报告 `runSchema.parse` 通过（SC-006）+ runId 前缀 + 双跑 runId 不同结果一致 + **进程干净退出**（execa 正常返回即证无悬挂计时器，SC-005 的用户可见面）+ 文本/JSON 双模式断言（依赖 T006）

**Checkpoint**: US1 独立交付——`fleet run` MVP 成立（Fleet Kernel 通电）

---

## Phase 4: User Story 2 - Fake 行为矩阵 (Priority: P2)

**Goal**: roadmap 必测六项全部自动化断言（FR-011）

**Independent Test**: quickstart B 段——`pnpm vitest run --project runtime`

- [x] T008 [US2] Fake 行为矩阵测试 `packages/runtime/src/fake.test.ts`：timeout 诚实（hang + timeoutMs=50 → timeout 且延迟到点后 settleLog 无第二记录）；cancel 即时（hang + cancel 毫秒级 cancelled，并行执行不受影响）；timeout/cancel 竞争单次 settle；failure/error 结构化码与 detail；cleanup（任意结束路径后 inflightSize === 0，真实短延迟 + fake timers 混合断言 clearTimeout 全量）；画像序（reflex < wisdom）与 zeroDelays；脚本耗尽重复末项（依赖 T003）
- [x] T009 [US2] 矩阵贯通 runner：e2e 扩展 `tests/cli/run.test.ts`——tmp 必败 mission（重试后仍败）→ 退出码 1 + attempts=2 + 下游 skipped + 传播链（retry/failure 六项之二在端到端的体现）；3 无依赖任务 tmp mission → 峰值并发 3（concurrency 项）（依赖 T007）

**Checkpoint**: 必测六项合同化完成——真实 Adapter（M7）有据可依

---

## Phase 5: User Story 3 - 桥接与 Run 记录 (Priority: P3)

**Goal**: 桥接规则可断言、Run/TaskRun 实例化、事件顺序保证

**Independent Test**: quickstart B/D/E 段——请求字段断言、事件顺序、
非法 mission 零执行

- [x] T010 [US3] 桥接与 runner 单元测试 `packages/runtime/src/bridge.test.ts` + `packages/runtime/src/runner.test.ts`：请求字段断言（runId 前缀且每次执行唯一/agentId 格式/prompt 模板/cwd/timeoutMs 三档优先级推导 + perTaskTimeoutMs 报告可追溯）；内存 FS runner——失败 mission 传播、autonomous note、非法 mission 校验前置且 Fake.requests 为空（US1 场景 2 的零执行断言）（依赖 T005）
- [x] T011 [US3] RunReport 与事件断言：taskRuns 时间戳（最后执行）与状态机合法性（runSchema 100%，SC-006）+ 事件顺序（started 先于终态、stderr 不污染 stdout——e2e 与单元双断言）（依赖 T007、T010）

**Checkpoint**: M4 Run/TaskRun 实体落地——M11 持久化的数据形态就绪

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T012 [P] 更新根 `README.md`：`fleet run` 用法（含任务表样例）、进度更新至 M6 + **Fleet Kernel release gate（M4–M6）达成声明**、仓库结构补 packages/runtime；M6 规格/验证手册链接
- [x] T013 按 quickstart.md 走查并记录（A 端到端 / B 矩阵 / C 失败 / D autonomous / E 前置拒绝）；问题回流修复后 `pnpm check` 全绿并按逻辑组提交 git

---

## Dependencies

### Phase Completion Order

- **Setup (Phase 1)** → **Foundational (Phase 2)** → 阻塞全部故事
- **US1 (Phase 3)**：依赖 T003（Fake）；bridge → runner → CLI → e2e 顺序（同链）
- **US2 (Phase 4)**：T008 只依赖 T003——**可与 US1 的 T004–T006 并行**；T009 依赖 T007
- **US3 (Phase 5)**：依赖 T005/T007（断言已实现的桥接与编排）
- **Polish (Phase 6)**：依赖全部故事完成

### Within Each User Story

- US1：bridge（T004）→ runner（T005）→ CLI（T006）→ e2e（T007）——严格顺序（依赖链）
- US2：fake.test（T008）独立；runner 矩阵 e2e（T009）在 T007 后
- US3：单元（T010）→ 报告/事件断言（T011）

### Parallel Opportunities

- 跨故事：T008（US2 fake 矩阵）与 T004–T006（US1 实现）并行——不同文件
- 单人开发按 P1→P2→P3 顺序推进即可

---

## Parallel Example: US1 与 US2 并行

```bash
# T003 完成后，两类不同文件可同时启动：
Task: "桥接 packages/runtime/src/bridge.ts"
Task: "Fake 行为矩阵 packages/runtime/src/fake.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + Phase 2 → 契约与 Fake 就绪
2. Phase 3（US1）→ `fleet run` 端到端
3. **STOP and VALIDATE**: demo.yaml 跑通 + 报告过 schema + 进程干净退出（T007）后即为可演示 MVP

### Incremental Delivery

1. US1 → fleet run 端到端（MVP，Fleet Kernel 通电）
2. US2 → 必测六项矩阵（契约合同化）
3. US3 → 桥接规则 + Run 记录 + 事件（M11 地基）
4. Polish → README + 走查，M6 验收关闭 + **Fleet Kernel release gate 声明**

---

## Notes

- [P] = 不同文件且无未完成依赖
- 每完成一个任务或逻辑组做一次 git commit（分支 007-m6-runtime-fake-agents）
- 停在任一 Checkpoint 均可独立验证该故事
- 宪法红线：仅注册 Fake（真实 Adapter 属 M7，FR-010）；execute 异常不逃逸 / timeout 诚实 / cancel 单次 settle / cleanup 完备（契约四条款）；无 Run 落盘（M11）、无权限强制（M7/M8）、无动态预算（M10）；零新增依赖；e2e 全走 Fake（宪法 IV）
- 时序断言防抖：timeout/cancel 用例用小毫秒（50ms 级）+ 量级断言（< 剩余延迟），不做紧阈值
- 避免：模糊任务、同文件冲突（bridge/runner/CLI 依赖链顺序执行；T009/T011 扩展既有测试文件在其前置完成后进行）
