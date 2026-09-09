# Tasks: M1 CodeGraph + Fallback（仓库调查链路）

**Input**: Design documents from `/specs/002-m1-codegraph-fallback/`

**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/ ✅ quickstart.md ✅

**Tests**: 包含测试任务——spec 的 SC-002 要求故障注入矩阵 100% 覆盖，
SC-004/005 均以测试为验收证据。

**Organization**: 按 spec 用户故事分组（US1 提问即调查 P1 / US2 无缝
降级 P2 / US3 适配层与策略 P3）。共享实体（适配层契约、假后端、
夹具仓库）放 Foundational——它们阻塞所有故事。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、无未完成依赖）
- **[Story]**: 所属用户故事
- 所有路径相对仓库根

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 新包骨架与测试夹具

- [x] T001 初始化 `packages/repository`：package.json（@fleet/repository，依赖 @fleet/core）、tsconfig.json 继承 base、tsup 配置（对齐 packages/core 模板）、空 `src/index.ts`，并纳入 vitest projects（更新根 `vitest.config.ts` 增加 repository project）
- [x] T002 [P] 创建夹具仓库 `tests/fixtures/sample-repo/`：5–8 个 TS/YAML 文件、已知符号集（如 `PaymentService.charge`、`parseInvoice`）、一对同名符号（`Logger` 类 ×2 文件）、一个配置驱动行为文件、一个含"生成代码"标记的文件，附 `tests/fixtures/sample-repo/README.md` 说明符号清单

**Checkpoint**: `pnpm build` 含 repository 包全绿

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 适配层契约、真实实现、健康判定、假后端——所有故事的地基

- [x] T003 定义适配层契约 `packages/repository/src/codegraph/contract.ts`：CodeGraphAdapter 接口、AdapterResult、CodeGraphFailure（unavailable/timeout/error/stale）、SymbolHit / SymbolEdge / ImpactReport / CodeGraphHealth 的 Zod schema 与类型（对齐 contracts/codegraph-adapter.md）
- [x] T004 实现 CLI 适配器 `packages/repository/src/codegraph/cli-adapter.ts`：execa 调 `codegraph query/callers/callees/impact/status --json`，timeout 5s（kill→timeout）、ENOENT→unavailable、非零退出/解析失败→error（detail 附 stderr 首行）；**禁止调用 init/index/sync/uninit/daemon**（依赖 T003）
- [x] T005 [P] 实现健康判定 `packages/repository/src/codegraph/health.ts`：`status --json` → CodeGraphHealth；stale 判定 = !initialized || pendingChanges>0 || reindexRecommended || state!=='complete'（research.md D4，依赖 T003）
- [x] T006 [P] 实现假后端 `packages/repository/src/codegraph/fake-adapter.ts`：构造参数脚本化各方法返回（成功/各类失败/延迟模拟超时），失败也走 `{ok:false}` 返回路径（依赖 T003）
- [x] T007 [P] 适配层单元测试 `packages/repository/src/codegraph/cli-adapter.test.ts`：用真实 CLI 对本仓库实测（已建索引）验证 query/status 映射字段；FakeCodeGraphAdapter 行为契约测试（依赖 T004、T006）

**⚠️ CRITICAL**: T003–T007 完成前不得开始任何用户故事

**Checkpoint**: 适配层可用、可替换、被测试覆盖

---

## Phase 3: User Story 1 - 提问即调查 (Priority: P1) 🎯 MVP

**Goal**: 健康路径端到端——`fleet repo investigate "<问题>"` 返回经源码锚定的 references

**Independent Test**: quickstart「健康路径」——investigate "FleetError 在哪里被抛出"，references 抽样 100% 锚定真实源码（SC-004），耗时 ≤10s（SC-001）

- [x] T008 [P] [US1] 实现源码阅读与锚定校验 `packages/repository/src/fallback/source.ts`：读回文件、校验 startLine 处实际存在内容、截取 ≤5 行 snippet、产物 Reference（origin=source，verified=true）；行号越界/文件缺失返回 conflict 信号（静态真源，FR-008）
- [x] T009 [P] [US1] 实现问题解析 `packages/repository/src/investigation/planner.ts`：确定性规则提取符号样式 token（驼峰/帕斯卡/snake/全大写）、路径 token（含 / 或扩展名）、关键词（去停用词）→ 检索计划（research.md D3）
- [x] T010 [US1] 实现基础策略 `packages/repository/src/investigation/policy.ts`：validate(candidate references + 上下文) → accept / escalate(reason)；覆盖 missing_symbol / ambiguous（多候选）/ empty 三类基础判定（依赖 T003）
- [x] T011 [US1] 实现 investigate 编排（健康路径）`packages/repository/src/investigation/investigate.ts`：plan → health → symbol 查询 + callers/callees → policy.validate → source 锚定复核 → 去重排序 → InvestigationResult（依赖 T004、T005、T008、T009、T010）
- [x] T012 [US1] 注册 CLI 命令 `apps/cli/src/commands/repo.ts` + `bin.ts` 接线：`fleet repo investigate <question> [--repo] [--json] [--max-refs] [--include-generated]`；文本/JSON 双输出、退出码 0/1/2、`repo.investigate.completed` 事件走 stderr（对齐 contracts/cli.md）
- [x] T013 [US1] 单元测试：planner token 提取矩阵、policy 三类判定、source 锚定（含越界→conflict）；e2e `tests/cli/investigate.test.ts` 健康路径——本仓库真实索引上 investigate "loadFleetConfig"，断言 references 非空、verified=true、pathsUsed 含 codegraph、--json 可解析、退出码 0

**Checkpoint**: US1 独立交付——健康路径 MVP 成立

---

## Phase 4: User Story 2 - 无缝降级 (Priority: P2)

**Goal**: 七类降级触发全部自动走 search → source，永不失败、原因结构化

**Independent Test**: quickstart「故障注入矩阵」——场景 1/3/4/6 手工 + 全矩阵自动化；SC-002（100% 降级仍出结果）、SC-003（每次降级可解释）

- [x] T014 [P] [US2] 实现原生搜索 `packages/repository/src/fallback/search.ts`：ripgrep（`rg --json`，timeout 3s、上限 100 条）+ 内置遍历双实现（rg 缺失时降级，engine=walk 标注 degraded），统一 SearchHit 结构（research.md D2）
- [x] T015 [US2] 扩展 investigate 降级链 `packages/repository/src/investigation/investigate.ts`：health 失败（unavailable/timeout/stale）与 symbol 阶段失败（missing_symbol/ambiguous/empty/error）→ 记 FallbackReason → search → source 锚定 → 汇总 degraded=true（依赖 T014）
- [x] T016 [US2] 单元测试（假后端全矩阵）`packages/repository/src/investigation/investigate.test.ts`：FakeCodeGraphAdapter 注入 unavailable/timeout/error/stale/missing_symbol/ambiguous/empty/conflict 八种场景，断言每种都降级、仍返回结果、fallbacks 含对应 code（SC-002/003 的主证据）
- [x] T017 [US2] e2e 故障注入 `tests/cli/investigate.test.ts` 扩展：受控 PATH（前置空 bin 目录）模拟 codegraph 缺失；夹具仓库 touch 文件不 sync 模拟 stale；不存在符号名与无关词场景；断言退出码恒为 0（依赖 T015）
- [x] T018 [US2] 冲突处理验证：source 锚定发现 codegraph 行号偏移时以源码为准、记 conflict、reference 修正后仍 verified=true（并入 T016 测试矩阵）

**Checkpoint**: 宪法原则 I 的可执行落点完成——调查不因 CodeGraph 失败而失败

---

## Phase 5: User Story 3 - 适配层隔离与调查策略 (Priority: P3)

**Goal**: 高风险升级规则、git 辅助、后端可替换性验证、公共出口

**Independent Test**: quickstart「适配层替换验证」+「高风险模式」；SC-005（换后端零改消费者）

- [x] T019 [US3] 扩展高风险策略 `packages/repository/src/investigation/policy.ts`：高风险模式规则（引用动态调用/反射/DI 关键词、生成代码标记、配置驱动文件路径命中）→ 无条件 escalate 到 source 复核并记 high_risk（FR-007）
- [x] T020 [P] [US3] 实现 git 辅助 `packages/repository/src/fallback/git.ts`：最近变更文件列表与文件最后修改信息，供排序加权与 stale 佐证（execa 调 git，只读命令）
- [x] T021 [US3] 替换验证测试：同一 investigate 编排分别注入真实 CLI 适配器与 FakeCodeGraphAdapter 跑同一问题，断言消费者代码（investigation/ 与 cli/）零改动（SC-005，测试形态：类型层断言 + 行为对照）
- [x] T022 [P] [US3] 整理公共出口 `packages/repository/src/index.ts`：导出 investigate、适配层契约与全部类型，附 JSDoc 一行说明（M2 Wiki / M3 Evidence 的直接消费面）
- [x] T023 [P] [US3] 夹具仓库高风险场景测试：investigate 查询配置驱动行为文件，断言即使 codegraph 命中也出现 high_risk 降级记录且最终证据 verified=true（依赖 T019）

**Checkpoint**: 适配层稳定、策略完整、M2 可直接开工

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T024 更新根 `README.md`：新增 `fleet repo investigate` 用法、降级语义与快速示例，链接 specs/002-m1-codegraph-fallback/quickstart.md
- [x] T025 [P] 按 quickstart.md 执行全景走查并记录（健康路径计时 ≤10s、手工注入场景 1/3/4/6），问题回流修复
- [x] T026 性能防回归：健康路径 `durationMs ≤ 10000` 断言进 `tests/cli/investigate.test.ts`；`pnpm check` 最终全绿并按逻辑组提交 git

---

## Dependencies

### Phase Completion Order

- **Setup (Phase 1)** → **Foundational (Phase 2)** → 阻塞全部故事
- **US1 (Phase 3)**：依赖 T003–T011（适配层 + 编排件）；不依赖 US2/US3
- **US2 (Phase 4)**：依赖 US1 的编排（T011）与 T014（search）；在其上扩展降级链
- **US3 (Phase 5)**：依赖 US1/US2 的流水；扩展策略与验证隔离性
- **Polish (Phase 6)**：依赖全部故事完成

### Within Each User Story

- 契约（T003）先于实现（T004–T006）
- 编排件（T008–T010 可并行）先于编排（T011）先于 CLI（T012）先于 e2e（T013）
- 假后端矩阵测试（T016）是 SC-002 的主证据，先于 e2e 注入（T017）

### Parallel Opportunities

- Phase 1: T002；Phase 2: T005/T006 并行（T004 完成后 T007）
- US1: T008/T009 并行，随后 T010 → T011 → T012 → T013
- US2: T014 独立可先行；US3: T020/T022/T023 并行
- 单人开发按 P1→P2→P3 顺序推进即可

---

## Parallel Example: Phase 2

```bash
# T003 完成后，三个不同文件可同时启动：
Task: "CLI 适配器 packages/repository/src/codegraph/cli-adapter.ts"
Task: "健康判定 packages/repository/src/codegraph/health.ts"
Task: "假后端 packages/repository/src/codegraph/fake-adapter.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + Phase 2 → 适配层可用可替换
2. Phase 3（US1）→ 健康路径端到端
3. **STOP and VALIDATE**: 本仓库真实索引上 investigate + 抽样锚点核对（T013）后即为可演示 MVP

### Incremental Delivery

1. US1 → 提问即调查（MVP）
2. US2 → 七类降级（宪法 I 落地）
3. US3 → 高风险升级 + 可替换性（M2 地基）
4. Polish → README + 走查 + 性能断言，M1 验收关闭

---

## Notes

- [P] = 不同文件且无未完成依赖
- 每完成一个任务或逻辑组做一次 git commit（当前分支 002-m1-codegraph-fallback）
- 停在任一 Checkpoint 均可独立验证该故事
- 宪法红线：Fleet 代码不得出现对 codegraph init/index/sync/uninit 的调用（T004 注释中已声明）
- 避免：模糊任务、同文件冲突、跨故事依赖破坏独立性
