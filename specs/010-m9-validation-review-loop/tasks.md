# Tasks: M9 Validation + Review Loop（独立验收与审阅循环）

**Input**: Design documents from `/specs/010-m9-validation-review-loop/`

**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/ ✅ quickstart.md ✅

**Tests**: 包含测试任务——SC-001 自报矛盾（M9 验收锚点）/ SC-002
状态矩阵 / SC-003 三路径与上限强制 / SC-004 零 merge / SC-005 事件
重放全部以自动化为验收证据；e2e 全程 tmp git 仓库（不触碰本仓库）。

**Organization**: 按 spec 用户故事分组（US1 Validation Runner P1 /
US2 Wisdom 审阅循环 P2 / US3 fleet run 验证门与事件 P3）。实体 /
schema 扩展 / gate 端口 / retryable 信号放 Foundational——阻塞
全部故事。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、无未完成依赖）
- **[Story]**: 所属用户故事
- 所有路径相对仓库根

---

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 初始化 `packages/validation` 包：package.json（@fleet/validation，依赖 @fleet/core + @fleet/mission + @fleet/runtime + @fleet/workspace + @fleet/agents）、tsconfig / tsup（对齐 packages/workspace 模板）、空 `src/index.ts`，纳入 vitest projects（pnpm-workspace 已含 packages/* 通配则仅需目录就位）
- [x] T002 [P] 创建测试替身：`tests/fixtures/fake-clis/review-approved-cli.sh` 与 `review-reject-cli.sh`（`--version` exit 0；实际执行 stdout 印 `{"verdict":"approved"/"changes_requested","comments":"..."}`；reject 版支持 `FAKE_REVIEW_FLIP_FILE` 计数翻转——按调用次数先 reject 后 approved，驱动 SC-003 一轮修复路径）；`tests/fixtures/checks/` 下 `lint-pass.sh` / `lint-fail.sh` / `tests-pass.sh` / `tests-fail.sh` / `hang.sh`（hang = sleep 长于配置超时，驱动 timeout 路径）

**Checkpoint**: 包可构建、替身可执行

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 实体、schema 扩展、gate 端口、retryable 信号——所有故事的地基

- [x] T003 mission schema 扩展 `packages/mission/src/types.ts`：`validationSchema`（strictObject：`commands?: {lint?, typecheck?, tests?: string}`、`timeoutMs?: 正整数}`）与 `maxReviewLoops?: 非负整数`（可选字段，缺省值 2 不进 schema——运行时解析，research.md D8）；`packages/mission/src/mission.test.ts` 增用例：合法字段通过、负数/类型错误拒绝、未知字段仍拒绝、既有 mission 兼容（无新字段照常解析）
- [x] T004 [P] gate 端口与执行器接缝 `packages/workspace/src/types.ts` + `executor.ts`：定义 `GateEvaluation`（task / workspace / execution / reexecute(feedback)）/ `GateDecision`（pass、outcome ∈ approved|review_exceeded|review_error|fix_failed、detail?、retryable?）与 `WorkspaceGate`（evaluate + `packages` 报告面）；WorkspaceResolvingExecutor 配置增 `gate?`——inner 执行成功后调用 `gate.evaluate`（构造 reexecute 闭包转发 inner 二次执行），按 decision.pass 走既有 merge/destroy 处置（keep-on-finish 不变），任务结果 ok = decision.pass、outcome 进处置记录；执行器增 `reviews` getter 代理 gate.packages（缺省 undefined）；**无 gate = M8 行为逐字节不变**；`packages/workspace/src/executor.test.ts` 增 fake gate 用例（通过→merged / 拒绝→destroyed+任务失败 / reexecute 被调用反馈透传 / 无 gate 回归）
- [x] T005 [P] scheduler 终态信号 `packages/scheduler/src/types.ts` + `scheduler.ts`：TaskExecutor 结果增可选 `retryable?: boolean`（缺省 true）；settle 中 `result.retryable === false` → 直接终态 failed（不重入队，failureReason 照记）；`packages/scheduler/src/scheduler.test.ts` 增用例：retryable=false 失败一次即 failed（attempts=1）、缺省失败照旧重试（回归）
- [x] T006 实体定义 `packages/validation/src/types.ts`：ValidationCheck（kind/command/status/exitCode/outputExcerpt/durationMs/evidence/skipReason/required）、ValidationArtifact（id=art_ 前缀 createId、taskId/runId/workspaceRef/loop、checks 固定序、overall 三态、diffStat、createdAt）、ValidationProfile（checks 三键 command/required、timeoutMs、maxReviewLoops）、ReviewVerdict、ReviewFailure、ReviewPackage、ValidationEvent 五型、DEFAULT_MAX_REVIEW_LOOPS=2 / DEFAULT_CHECK_TIMEOUT_MS=300_000 / DEFAULT_REVIEW_TIMEOUT_MS=120_000（对齐 data-model.md §1–§8）

**⚠️ CRITICAL**: T003–T006 完成前不得开始任何用户故事

**Checkpoint**: 端口与信号就绪——判定逻辑可装配

---

## Phase 3: User Story 1 - Validation Runner 独立验收 (Priority: P1) 🎯 MVP

**Goal**: 四类检查结构化执行，ValidationArtifact = 系统级证据源（SC-002）

**Independent Test**: quickstart 场景 1/2 的库级底座——tmp 仓库 +
manager.getDiff + 替身检查命令的状态矩阵

- [x] T007 [US1] Profile 解析 `packages/validation/src/profile.ts`：`resolveValidationProfile(mission, workspacePath)`——mission.validation.commands 显式 → required=true；否则读 workspacePath/package.json scripts（lint/typecheck/test 存在 → `<pm> run <script>` / `<pm> test`，required=true）；否则 required=false；`<pm>` 按 lockfile（pnpm-lock.yaml→pnpm、yarn.lock→yarn、否则 npm）；timeoutMs = mission.validation.timeoutMs ?? 300_000；maxReviewLoops = mission.maxReviewLoops ?? 2（research.md D5）；`packages/validation/src/profile.test.ts`：三级解析优先级 / lockfile 识别 / 无 package.json（skipped 形态）/ mission 覆盖全参
- [x] T008 [US1] 检查执行器 `packages/validation/src/runner.ts`：ValidationRunner.validate({task, workspace, loop, runId?})——① diff：manager 注入（构造参数 `manager: WorkspaceManager`）调 getDiff，空 diff → 其余检查 skipped（skipReason=empty-diff）、overall=noop；非空 → 计算 diffStat（文件数/增删行）；② lint/typecheck/tests：execa 受控子进程（cwd=workspace.path、shell 命令串解析、timeoutMs=profile、超时 kill → status=timeout 含已运行时长、非零退出 fail 含 exitCode）；顺序执行不短路；输出摘要头 2KB+尾 2KB+截断标注；整体 = 任一 required fail/timeout → fail；①+② → ValidationArtifact（id=art_ 前缀）；`packages/validation/src/runner.test.ts`：**状态矩阵**（pass/fail/skipped×2 原因/timeout × 各检查类）全结构化断言、noop 短路、顺序断言（事件序/执行序 diff→lint→typecheck→tests）、主仓零写入（git status 采样）、输出截断标注（依赖 T002、T006、T007）

**Checkpoint**: US1 独立交付——Validation Runner MVP 成立（artifact 可断言）

---

## Phase 4: User Story 2 - Wisdom 审阅循环 (Priority: P2)

**Goal**: 裁决结构化 + 显式循环 + 上限强制（SC-003 三路径）

**Independent Test**: quickstart 场景 3 的库级底座——Fake 双实例
脚本化裁决驱动 gate 三路径

- [x] T009 [US2] 审阅执行器 `packages/validation/src/review.ts`：AgentReviewer（config：adapter: RuntimeAdapter、repoRoot、timeoutMs=120_000 可配）——构造 RuntimeRequest（agentId=`agent:<taskId>-review`、cwd=repoRoot、env=FLEET_AGENT_ROLE=wisdom + FLEET_PERMISSION=READ_ONLY、timeoutMs、prompt=确定性模板：Mission 摘要 + Artifact 摘要 + diff 头 8KB 摘录与 diffStat + priorFeedback）；裁决解析两级（JSON {verdict, comments} 枚举校验 → 裸行 approved/changes_requested 匹配）→ ReviewVerdict；适配器失败/解析失败 → `{ok:false, code, detail}`（fail-closed，research.md D6）；`packages/validation/src/review.test.ts`：JSON/裸词/前后空白宽容、非法 verdict 拒绝、超时与错误 fail-closed、请求 env 与 cwd 断言（权限链路 + READ_ONLY 物理范围）
- [x] T010 [US2] 循环编排 `packages/validation/src/gate.ts`：ValidationReviewGate implements WorkspaceGate（config：runner/reviewer/manager/profile/repoRoot/runId?/emitEvent?）——evaluate：execution.ok=false → {pass:false, outcome:fix_failed}（可重试，M5 语义）；循环（data-model §7 状态机）：validate → emit started/completed → fail 且 rounds<max → reexecute(验证失败摘要) rounds+1 loop+1 ↺；fail 且 rounds≥max → review_exceeded（retryable=false）+ emit exceeded；pass/noop → maxReviewLoops=0 ? approved : review → emit → approved 终态 / changes_requested 同修复路径；reviewer ok=false → review_error（retryable=false，不进循环）；每 gated 任务收一份 ReviewPackage（terminal/rounds/maxReviewLoops/artifacts 全轮次/verdicts/diffStat/disposition 填充点）；`packages/validation/src/gate.test.ts`（Fake runner/reviewer 注入）：三路径（0 轮 / 1 轮修复后通过 / 连续拒绝 → 第 2 轮后 review_exceeded 且**无第 3 轮修复发起**——reexecute 调用计数断言）、validation-fail 修复路径统一、审阅错误 fail-closed 直达、事件序完备（started/completed 对 + exceeded）、packages 全轮次内容（依赖 T006、T008、T009）
- [x] T011 [US2] 真管理器集成 `packages/validation/src/gate.integration.test.ts`：tmp git 仓库 + 真 GitWorktreeManager + 双 Fake 实例（实现者 touchOnSuccess 写 worktree / 审阅者脚本化裁决 `script: {'<taskId>-review': [...]}`——分离避免越权写，research.md D9）+ WorkspaceResolvingExecutor（gate 装配）→ Scheduler 驱动：approved → merged + 主分支含变更；连续 reject + maxReviewLoops=2 → 任务 failed（failureReason 含 review_exceeded）+ 零 merge（主分支 git 断言）+ retryable=false 生效（attempts=1 不重试）；验证命令 fail（checks/tests-fail.sh）→ 修复循环耗尽 → review_exceeded（依赖 T004、T005、T010）

**Checkpoint**: 验收锚点机制成立——上限结构性强制、判定独立于自报

---

## Phase 5: User Story 3 - fleet run 验证门与事件 (Priority: P3)

**Goal**: fleet run 全链 + 事件流 + ReviewPackage（SC-001/004/005/006）

**Independent Test**: quickstart 场景 1/2/4——fleet run 二进制于
tmp 仓库的端到端

- [x] T012 [US3] 报告合成 `packages/runtime/src/runner.ts`：ExecutorReportFace 增 `reviews?`（结构化形态）；RunReport 增可选 `reviews`（duck-typing 合成，同 M8 workspaces 模式——类型只描述结构不 import @fleet/validation，防环）；`packages/runtime/src/runner.test.ts` 增用例：reviews 缺省不影响既有报告、存在时透传
- [x] T013 [US3] CLI 集成 `apps/cli/src/commands/run.ts`：`--no-validation-gate` 旗标（默认开；仅 worktree 模式装配——--no-worktree 保持 M7 直通，两开关正交）；buildExecutor 增 gate 装配（profile=resolveValidationProfile(mission, repoRoot)、runner=ValidationRunner(manager)、reviewer=AgentReviewer(registry.resolve('wisdom'))、emitEvent → 既有 stderr FleetEvent 通道（type 命名空间合法校验））；人类报告追加验证/审阅行（每写授权任务：`验证 <loops> 轮 · <terminal> · 末轮结论摘要`）；`--json` 输出含 reviews
- [x] T014 [US3] e2e `tests/cli/validation.test.ts`（tmp git 仓库 + fleet run 二进制，GIT_ENV 同 M8 模式）：① **SC-001 锚点**——write-cli 替身 stdout 自报 `tests passed` + mission 配 tests=tests-fail.sh + wisdom=review-approved-cli（审阅者本会批准）→ 任务 failed（review_exceeded）+ 主分支零合并 + 报告 reviews[0].artifacts 末轮 tests=fail（自报零影响）；② SC-004 正侧——checks 全 pass + review-approved → completed + 主分支含 write-cli 文件（merged）+ workspaces[0].action=merged；③ SC-003 三路径——review-reject（FAKE_REVIEW_FLIP_FILE 翻转）一轮修复后通过（rounds=1、artifacts 长 2）；连续 reject + maxReviewLoops=2 → review_exceeded、rounds=2、事件中 review.completed 恰 3 次、无第 4 次审阅/第 3 次修复（stderr 事件计数断言）；④ SC-005——stderr FleetEvent 流含 task.validation.*/task.review.*（serializeEvent round-trip + 重放还原轮次历史）；⑤ SC-006——三终态（approved / review_exceeded / review_error（reviewer 替身输出乱码 → verdict_unparseable 路径））ReviewPackage 均在 --json 报告；⑥ 逃生口——--no-validation-gate 回退 M8 auto（成功即合无验证）、--no-worktree M7 直通；⑦ timeout 路径——hang.sh + 小 timeoutMs → status=timeout 按 fail 计（依赖 T001、T002、T013）

**Checkpoint**: M9 验收锚点 e2e 全绿

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T015 [P] 全量回归：`pnpm build && pnpm test`（全部 packages + e2e）零失败零跳过；宪法对照复核（权限边界：Reviewer READ_ONLY + cwd 主仓根；Validation 独立性：判定路径无实现者输出；上限：结构性不可能无限循环）；README 或包文档补 @fleet/validation 一节（若既有文档结构要求）
- [x] T016 quickstart.md 走查：场景 1/2/3/4 按文档可复现（命令与预期对齐实测）；spec SC-001..006 逐条勾验；提交 milestone commit

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖，立即开始
- **Foundational (Phase 2)**: 依赖 Phase 1——**阻塞全部用户故事**
- **US1 (Phase 3)**: 依赖 T003（profile 读 mission 字段）、T006
- **US2 (Phase 4)**: 依赖 US1（gate 消费 runner/artifact）+ T004/T005
- **US3 (Phase 5)**: 依赖 US2（gate 装配）+ T012
- **Polish (Phase 6)**: 依赖全部

### Within Each User Story

- 实体/端口先行、执行器次之、测试随后（本里程碑测试与实现同任务交付——断言即契约）
- US2 的 T011 真管理器集成依赖 T004/T005 的接缝信号

### Parallel Opportunities

- T002 与 T001 并行；T003/T004/T005 并行（不同包）；T007 与 T009 并行（US1/US2 无共享文件——T009 仅依赖 T006）；T012 可与 T010 并行

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + Phase 2 → 地基
2. Phase 3（US1）→ Validation Runner 独立可用（artifact 可断言）
3. **STOP and VALIDATE**: 状态矩阵单测绿

### Incremental Delivery

- +US2 → 循环与上限成立（库级锚点）
- +US3 → fleet run 全链（e2e 锚点 SC-001）
- +Polish → 全量回归 + 文档

---

## Notes

- [P] 任务=不同文件、无未完成依赖；实现按优先级串行亦可（本里程碑规模单线约 1 天）
- 每个 Checkpoint 可独立验证；commit 按任务组
- 判定路径纯净性是 SC-001 的核心——任何"顺手"把实现者 output 塞进判定的实现都会被锚点测试击落
