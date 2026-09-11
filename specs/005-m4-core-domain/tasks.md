# Tasks: M4 Core Domain（任务域实体与校验）

**Input**: Design documents from `/specs/005-m4-core-domain/`

**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/ ✅ quickstart.md ✅

**Tests**: 包含测试任务——SC-002（10 类故障矩阵 100% 拦截）与
SC-003（多错误一次报全）以自动化为主验收证据；SC-005（错误自
解释）走查执行。

**Organization**: 按 spec 用户故事分组（US1 编写并校验 Mission P1 /
US2 执行模式语义 P2 / US3 任务结构与关联校验 P3）。共享地基
（包骨架、实体 schema、加载器、语义层）放 Foundational——阻塞
全部故事。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、无未完成依赖）
- **[Story]**: 所属用户故事
- 所有路径相对仓库根

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 分支与活样例

- [x] T001 创建并切换实现分支 `005-m4-core-domain`（当前在 004-m3-evidence-system；spec/plan 文档随首个实现提交一并纳入）
- [x] T002 [P] 创建活样例 `missions/demo.yaml`：合法 execution mission（对齐 contracts/mission-file.md 完整样例——双任务 focus→reason 依赖链、两类约束、三段验收、plan 含 summary/rationale）；文档 / 夹具 / CI 冒烟三用

**Checkpoint**: 分支就绪、demo 样例可作为格式契约参照

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: mission 包骨架、实体 schema、两层校验——所有故事的地基

- [x] T003 初始化 `packages/mission` 包：package.json（@fleet/mission，依赖 @fleet/core + zod + yaml）、tsconfig.json 继承 base、tsup 配置（对齐 packages/core 模板）、空 `src/index.ts`，并纳入 vitest projects（更新根 `vitest.config.ts` 增加 mission project）
- [x] T004 定义实体 schema `packages/mission/src/types.ts`：Requirement（text 非空 + id? 命名规则）、Constraint（discriminatedUnion：maxDurationMs/maxTokens，value 非负整数）、AcceptanceCriteria（given/when/then 三段非空）、Plan（summary 非空 + rationale?）、Task（id/goal/agentRole 五角色枚举/dependsOn 默认 []/constraints?/acceptance?）、Mission（全树 strictObject，planningMode 枚举大小写敏感）、Artifact（art_ 前缀/taskId/kind/payload/createdAt）、Run（run_ 前缀/missionId/status 五态枚举/taskRuns）；id 命名 `/^[a-z0-9][a-z0-9-]*$/`（对齐 data-model.md §1–§8）
- [x] T005 实现加载器 `packages/mission/src/loader.ts`：loadMission（raw, {sourcePath}）→ Mission——复刻 config loader 模式：空文本/缺失 → 文件级错误；YAML 解析失败（含多文档）/顶层非对象 → MISSION_PARSE_FAILED；Zod safeParse 失败 → MISSION_INVALID + toIssues（ConfigIssue 转换，unrecognized_keys 逐字段展开，research.md D2/D3）；错误码常量 MISSION_FILE_MISSING/FILE_UNREADABLE/PARSE_FAILED/INVALID
- [x] T006 [P] 实现语义层 `packages/mission/src/semantic.ts`：validateSemantics（Mission）→ ConfigIssue[]——task id 重复（标两个位置）、dependsOn 悬空（引用方 + 被引 id）、自环依赖、execution 缺 plan 或 tasks 空（错误信息含模式要求，US2 场景 2）、requirement id 重复、mission/task id 命名规则兜底（依赖 T004）
- [x] T007 [P] Foundational 单元测试：`packages/mission/src/types.test.ts`（结构矩阵：必填/枚举/未知字段/多文档/顶层数组/nested tasks 非对象项）+ `packages/mission/src/semantic.test.ts`（语义规则矩阵：六类规则 + execution/autonomous 模式差异 + 一次报全）+ Artifact/Run 合法非法样例（依赖 T004–T006）

**⚠️ CRITICAL**: T003–T007 完成前不得开始任何用户故事

**Checkpoint**: 两层校验可用可测——纯函数层闭环

---

## Phase 3: User Story 1 - 编写并校验 Mission (Priority: P1) 🎯 MVP

**Goal**: `fleet mission validate <path>` 端到端：合法文件摘要、
非法文件一次报全、文件级故障不崩溃

**Independent Test**: quickstart A/B 段——demo.yaml 通过 + 摘要
（SC-001）；同文件双跑输出一致（SC-004）；文件级故障矩阵退出码 1
且信息明确

- [x] T008 [US1] 实现校验编排 `packages/mission/src/validate.ts`：validateMissionFile（path, fs）→ MissionValidationReport——读文件（RealFileSystem 可注入）→ loadMission → semantic 两层 issues 合并一次输出（FR-007）；文件不存在/不可读/目录路径 → fileError 标注（不抛异常给 CLI）；出口导出全部公共面（schema/semantic/loader，research.md D8 的 M5 预留）（依赖 T005、T006）
- [x] T009 [US1] 注册 CLI `apps/cli/src/commands/mission.ts` + `bin.ts` 接线：`fleet mission validate <path> [--json]`——文本模式通过摘要 / 失败逐条 `[path] 期望 X，实际 Y：message`；`--json` 输出 MissionValidationReport；退出码 0/1/2；`mission.validated` 事件走 stderr（对齐 contracts/cli.md）
- [x] T010 [US1] US1 测试：e2e `tests/cli/mission.test.ts`——demo.yaml 通过 + 摘要字段断言 + stderr 事件 + 耗时 < 1s（SC-001）；同命令双跑 stdout 逐字节一致（SC-004）；文件级故障四态（路径不存在 / 传目录 / 二进制文件 / 多文档 YAML）退出码 1 + 明确信息 + 0 崩溃；未知顶层字段（`acceptences` 拼错）被拒绝且逐字段列出（US1 场景 3）

**Checkpoint**: US1 独立交付——mission 校验 MVP 成立

---

## Phase 4: User Story 2 - 执行模式语义 (Priority: P2)

**Goal**: planningMode 双模式校验语义可演示、可追溯（宪法 V 输入契约）

**Independent Test**: quickstart C 段——autonomous 极简文件通过；
同文件改 execution 报模式要求

- [x] T011 [US2] US2 测试：e2e 扩展 `tests/cli/mission.test.ts`——模式矩阵：execution 缺 plan → 错误含 "execution"（模式要求说明）；execution 有 plan 无 tasks → 同类错误；execution 齐全 → 通过；autonomous 只有 requirements（无 plan/tasks）→ 通过；`planningMode: Execution` / `auto` → 枚举错误列出合法值（大小写敏感，US2 场景 4）；planningMode 缺失 → required 错误

**Checkpoint**: 模式语义钉进输入契约——M7 的 Reason 行为约束有据可依

---

## Phase 5: User Story 3 - 任务结构与关联校验 (Priority: P3)

**Goal**: task 静态合法性全拦截；Artifact/Run schema 就绪（M5/M6 消费）

**Independent Test**: quickstart B 段——故障矩阵 10 类逐项断言
（SC-002）+ 多错误文件一次报全（SC-003）

- [x] T012 [US3] US3 测试：e2e 扩展 `tests/cli/mission.test.ts`——SC-002 十类故障矩阵（缺 goal / 空验收 / 非法 planningMode / execution 缺 plan / 重复 task id / 非法角色 coder / 悬空依赖 / 自环 / 未知字段 / maxTokens 负数）逐项注入 tmp 文件断言退出码 1 + issues 含正确字段路径（矩阵表见 quickstart B 段）；组合 3+ 错误的单文件断言 issues 数量与注入一致（SC-003 一次报全，无遗漏）
- [x] T013 [US3] Artifact/Run 边界单元测试 `packages/mission/src/types.test.ts` 扩展：合法样例（对齐 data-model §7–§8 形态：art_/run_ 前缀、TaskRun 状态枚举含 skipped）、非法样例（坏前缀/非法状态/缺 createdAt）——为 M5/M6 消费提供契约测试基线

**Checkpoint**: M5 拿到静态合法的任务节点与实体 schema——DAG 层可开工

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T014 [P] 更新根 `README.md`：`fleet mission validate` 用法、mission 文件格式速查（链接 contracts/mission-file.md）、进度更新至 M4（Phase B 开工），仓库结构补 packages/mission 与 missions/
- [x] T015 按 quickstart.md 全景走查并记录：A/B/C/D 四段（含 SC-005 错误自解释——仅凭输出修复每类故障）；问题回流修复后 `pnpm check` 全绿并按逻辑组提交 git

---

## Dependencies

### Phase Completion Order

- **Setup (Phase 1)** → **Foundational (Phase 2)** → 阻塞全部故事
- **US1 (Phase 3)**：依赖 T003–T007；不依赖 US2/US3
- **US2 (Phase 4)**：依赖 US1 的 CLI（T009）——e2e 扩展同文件
- **US3 (Phase 5)**：依赖 US1 的 CLI（T009）；T013 只依赖 T004，可并行
- **Polish (Phase 6)**：依赖全部故事完成

### Within Each User Story

- Foundational：包骨架（T003）→ schema（T004）→ loader（T005）∥ semantic（T006）→ 单元矩阵（T007）
- US1：编排（T008）→ CLI（T009）→ e2e（T010）
- US2/US3：e2e 全部扩展同一文件（T011/T012 顺序执行，避免同文件冲突）

### Parallel Opportunities

- Phase 1: T002；Phase 2: T006 与 T005 并行（T004 之后）；T013 与 US2 并行
- 单人开发按 P1→P2→P3 顺序推进即可

---

## Parallel Example: Phase 2 中段

```bash
# T004 完成后，两个不同文件可同时启动：
Task: "加载器 packages/mission/src/loader.ts"
Task: "语义层 packages/mission/src/semantic.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + Phase 2 → 实体与两层校验就绪
2. Phase 3（US1）→ validate 命令端到端
3. **STOP and VALIDATE**: demo.yaml 校验 + 双跑一致 + 文件级故障四态（T010）后即为可演示 MVP

### Incremental Delivery

1. US1 → 校验命令（MVP）
2. US2 → 模式语义（宪法 V 输入契约）
3. US3 → 故障矩阵全拦截 + Artifact/Run 契约
4. Polish → README + 走查，M4 验收关闭

---

## Notes

- [P] = 不同文件且无未完成依赖
- 每完成一个任务或逻辑组做一次 git commit（分支 005-m4-core-domain）
- 停在任一 Checkpoint 均可独立验证该故事
- 宪法红线：M4 不做图语义（多节点环检测/拓扑/就绪选择/失败传播 = M5）；权限执行期强制 = M7/M8；零新增第三方依赖；core 与既有包零改动（mission 专属错误码经 FleetError 开放 code）
- e2e 故障注入一律写 tmp 文件（不污染仓库 missions/）；demo.yaml 是唯一提交进 git 的 mission
- 避免：模糊任务、同文件冲突（T011/T012 同文件顺序执行）、跨故事依赖破坏独立性
