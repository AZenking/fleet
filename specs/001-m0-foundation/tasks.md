# Tasks: M0 Foundation（工程基线）

**Input**: Design documents from `/specs/001-m0-foundation/`

**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/ ✅ quickstart.md ✅

**Tests**: 包含测试任务——spec 的 FR-006（能力"被测试覆盖"）与 SC-003（五类故障注入识别率 100%）明确要求测试作为验收证据。

**Organization**: 按 spec 用户故事分组（US1 质量门 P1 / US2 doctor P2 / US3 core 能力 P3）。实体归属其最早使用的故事（见 plan.md Constitution Check 与 data-model.md）。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、无未完成依赖）
- **[Story]**: 所属用户故事
- 所有路径相对仓库根

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 仓库与 monorepo 骨架

- [x] T001 在仓库根 `git init` 并创建 `.gitignore`（node_modules/dist/.fleet 运行时产物），首次提交纳入现有文档
- [x] T002 创建 monorepo 骨架：`pnpm-workspace.yaml`、根 `package.json`（engines.node ">=24"、scripts 占位）、`tsconfig.base.json`、目录 `apps/cli`、`packages/core`、`configs`、`tests/cli`（对齐 plan.md Project Structure）
- [x] T003 [P] 创建最小配置 `configs/fleet.yaml`（仅 `version: 1`，契约见 contracts/fleet-yaml.md）

**Checkpoint**: 骨架目录与工作区声明就绪

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 两个包可构建——所有用户故事的前置

- [x] T004 初始化 `packages/core`：`package.json`（@fleet/core）、tsup 配置（ESM+CJS+dts）、`src/index.ts` 空导出、`tsconfig.json` 继承 base
- [x] T005 [P] 初始化 `apps/cli`：`package.json`（bin: fleet，依赖 commander 与 workspace:@fleet/core）、tsup bundle 配置、`src/bin.ts` 最小入口、`tsconfig.json`
- [x] T006 根 `pnpm build` 串行脚本（core → cli）并在根 `package.json` 注册，验证 dist 产物生成

**⚠️ CRITICAL**: T006 完成前不得开始任何用户故事

**Checkpoint**: `pnpm install && pnpm build` 全绿

---

## Phase 3: User Story 1 - 一键质量门 (Priority: P1) 🎯 MVP

**Goal**: 全新克隆 → `pnpm install` → `pnpm check` 全绿（lint + format + build + test），任何失败非零退出并逐条定位

**Independent Test**: quickstart.md「安装与质量门」一节——正向全绿 + 注入一个 lint 违规反向验证非零退出

- [x] T007 [P] [US1] 配置 ESLint flat config（`eslint.config.js`，typescript-eslint 推荐 rules）与 `.prettierrc`（默认即可）
- [x] T008 [P] [US1] 配置 `vitest.workspace.ts`（覆盖 packages/core 与 tests/cli），两包 `package.json` 注册 `test` script
- [x] T009 [US1] 根 `package.json` 聚合 `check` script：lint → format:check → build → test 链式执行，任一失败立即非零退出（依赖 T007、T008）
- [x] T010 [P] [US1] 冒烟测试：`packages/core/src/smoke.test.ts` 与 `tests/cli/smoke.test.ts` 各一个最小断言，保证 test 目标有内容且跨包生效
- [x] T011 [US1] 实现 `fleet --version`：`apps/cli/src/commands/version.ts` + `bin.ts` 注册（FR-009），读取包版本单行输出
- [x] T012 [US1] 反向验证并恢复：临时注入未使用变量跑 `pnpm check` 确认非零退出与逐条定位，随后还原（对应 quickstart 反向验证场景）

**Checkpoint**: US1 独立交付——质量门可用，MVP 成立

---

## Phase 4: User Story 2 - 环境诊断 fleet doctor (Priority: P2)

**Goal**: `fleet doctor [--json]` 六项检查、ok/warning/error 分级、退出码 0/1、加速器缺失恒为 warning

**Independent Test**: quickstart.md「fleet doctor」+「故障注入验证」——健康路径、--json 解析、五类注入（#1/#2 由 T017 自动化，#3/#4/#5 手工或 e2e）

- [x] T013 [P] [US2] 实现 FleetError 统一错误模型 `packages/core/src/errors/`（code/category/message/context/cause，CONFIG_* 码，见 data-model.md §4）
- [x] T014 [P] [US2] 实现 FleetConfiguration schema + loader `packages/core/src/config/`（zod strict、逐字段 issues、CONFIG_MISSING/EMPTY/INVALID、向上找仓库根，契约见 contracts/fleet-yaml.md）
- [x] T015 [P] [US2] 实现 git 仓库检测 `packages/core/src/git/`（自 cwd 向上找 .git，返回根路径或 NOT_A_GIT_REPO）
- [x] T016 [P] [US2] 实现探测原语 `packages/core/src/probe/`（node/git/codegraph/agent-runtimes 命令存在性，execa，which 风格）
- [x] T017 [P] [US2] 单元测试 `packages/core`：config 合法/空/非法三态、git 检测双路径、semver 版本比较（模拟 engines 不满足与恰好等于最低版本两个边界）
- [x] T018 [US2] 实现 doctor 编排 `apps/cli/src/commands/doctor.ts`：六项检查固定顺序、不 fail-fast、单项崩溃降级不挂起、汇总 ready（依赖 T013–T016）
- [x] T019 [P] [US2] 实现人类可读渲染 `apps/cli/src/output/human.ts`（✓/⚠/✗、缩进建议行、summary，对齐 contracts/cli.md 示例）
- [x] T020 [P] [US2] 实现 `--json` 输出 `apps/cli/src/output/json.ts`（DiagnosticReport 稳定序列化，退出码与文本模式一致）
- [x] T021 [US2] CLI e2e `tests/cli/doctor.test.ts`（execa 拉起真实 bin）：健康退出码 0、`--json` 可解析且 ready 语义正确、非 git 目录与配置缺失/非法注入退出码 1（依赖 T018–T020）

**Checkpoint**: doctor 双格式独立可用，SC-003 五类注入全部有验收证据

---

## Phase 5: User Story 3 - 共享基础能力包 (Priority: P3)

**Goal**: M1 开发者从 @fleet/core 直接引用全部基础能力，零底座代码（SC-005）

**Independent Test**: quickstart.md「core 基础能力抽检」——合法/非法配置样例、ID 前缀与唯一性、git 双路径、内存 fs 下逻辑通过

- [x] T022 [P] [US3] 实现 Logger 接口 + 默认实现 `packages/core/src/logging/`（M0 同步 console 适配即可）
- [x] T023 [P] [US3] 实现 FleetEvent schema + JSON 序列化 `packages/core/src/events/`（data-model.md §3，不持久化）
- [x] T024 [P] [US3] 实现 ID 生成 `packages/core/src/ids/`（前缀 + crypto.randomUUID，提供 evt_/run_ 前缀常量）
- [x] T025 [P] [US3] 实现文件系统抽象 `packages/core/src/fs/`（真实/内存双实现，接口覆盖读写/存在/列目录）
- [x] T026 [P] [US3] 单元测试：ID 两次生成不同且带前缀、事件序列化往返、内存 fs 下 config loader 复测（不触碰真实磁盘）
- [x] T027 [US3] doctor 完成时发射 doctor.completed 事件：增强 `apps/cli/src/commands/doctor.ts`，复用 events/ids（依赖 T023、T024）
- [x] T028 [US3] 整理公共出口 `packages/core/src/index.ts`：导出全部八个能力模块并附 JSDoc 一行说明（"M1 直接引用"的落点）

**Checkpoint**: 全部基础能力可用、被测试覆盖、单一入口导出

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T029 编写根 `README.md`：安装、`pnpm check`、`fleet doctor [--json]` 用法，链接 specs/001-m0-foundation/quickstart.md
- [x] T030 [P] 按 quickstart.md 执行全景验收走查并记录结果（含 SC-002：doctor 健康环境计时 ≤ 5s），问题回流修复
- [x] T031 将 doctor 耗时断言加入 `tests/cli/doctor.test.ts`（durationMs ≤ 5000，防性能回归），确认 `pnpm check` 最终全绿

---

## Dependencies

### Phase Completion Order

- **Setup (Phase 1)** → **Foundational (Phase 2)** → 阻塞全部故事
- **US1 (Phase 3)**：依赖 Phase 2；不依赖其他故事
- **US2 (Phase 4)**：依赖 Phase 2；使用 core 能力在故事内自建（T013–T016），与 US1 无耦合
- **US3 (Phase 5)**：依赖 Phase 2 与 T023/T024 所属文件先于 T027；为 US2 已有模块补齐剩余能力
- **Polish (Phase 6)**：依赖全部故事完成

### Within Each User Story

- 实体/原语（T013–T016）先于编排（T018）
- 编排先于输出（T019/T020 可并行）先于 e2e（T021）
- 测试与实现同任务或紧随其后（TDD 可选：先写 T017/T021 让其失败再实现）

### Parallel Opportunities

- Phase 1: T003；Phase 2: T005；US1: T007/T008/T010 并行
- US2: T013/T014/T015/T016/T017 六任务全部并行（不同文件）；T019/T020 并行
- US3: T022–T026 五任务全部并行
- 不同故事在 Foundational 完成后可并行推进（单人开发按 P1→P2→P3 顺序即可）

---

## Parallel Example: User Story 2

```bash
# 六个不同文件的任务可同时启动：
Task: "FleetError 错误模型 packages/core/src/errors/"
Task: "FleetConfiguration schema+loader packages/core/src/config/"
Task: "git 仓库检测 packages/core/src/git/"
Task: "探测原语 packages/core/src/probe/"
Task: "config/git/版本比较单元测试 packages/core/"
# 汇合后串行：doctor.ts → human.ts/json.ts（并行）→ e2e
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + Phase 2 → 骨架可构建
2. Phase 3（US1）→ `pnpm check` 全绿
3. **STOP and VALIDATE**: 反向验证非零退出（T012）后即为可演示 MVP

### Incremental Delivery

1. US1 → 质量门（MVP）
2. US2 → doctor 诊断可演示
3. US3 → core 能力齐备，M1 可零底座开工
4. Polish → README + 走查 + 性能断言，M0 验收关闭

---

## Notes

- [P] = 不同文件且无未完成依赖
- 每完成一个任务或逻辑组做一次 git commit（T001 建立的仓库）
- 停在任一 Checkpoint 均可独立验证该故事
- 避免：模糊任务、同文件冲突、跨故事依赖破坏独立性
