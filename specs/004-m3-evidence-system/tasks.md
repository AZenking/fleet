# Tasks: M3 Evidence System（调查证据体系）

**Input**: Design documents from `/specs/004-m3-evidence-system/`

**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/ ✅ quickstart.md ✅

**Tests**: 包含测试任务——SC-002（高风险矩阵 100%）、SC-003（判定
可复现）、SC-005（冲突注入）只能以注入 + 自动化为验收证据；
SC-004（隔离）需集成后重钉。

**Organization**: 按 spec 用户故事分组（US1 结论带证据链 P1 /
US2 FAST/VERIFY 模式 P2 / US3 Wiki 接入与冲突裁决 P3）。共享地基
（实体 schema、模式裁决规则表、置信度规则表）放 Foundational——
阻塞全部故事。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、无未完成依赖）
- **[Story]**: 所属用户故事
- 所有路径相对仓库根

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 分支与高风险矩阵夹具

- [x] T001 创建并切换实现分支 `004-m3-evidence-system`（当前在 003-m2-llm-wiki；spec/plan 文档随首个实现提交一并纳入）
- [x] T002 [P] 扩展夹具仓库 `tests/fixtures/sample-repo/`：新增 `src/auth.ts`（login/session 符号）、`src/db-schema.ts`（migrations/schema 符号）、`src/public-api.ts`（导出面符号），更新 `tests/fixtures/sample-repo/README.md` 符号清单——高风险六类矩阵的 e2e 锚定对象（现有 payment/config-driven/rates.yaml 继续复用）

**Checkpoint**: 分支就绪、高风险矩阵的锚定文件存在

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 证据实体、模式裁决表、置信度表——所有故事的地基

- [x] T003 定义证据实体 `packages/repository/src/evidence/types.ts`：Evidence（九源枚举/verified/location/excerpt/symbol）、Finding（四类 kind/confidence/confidenceReason/conflicts/truncated）、EvidenceConflict（anchor_offset/dead_path + 双方陈述 + winner 恒 static_truth）、ModeResolution（requestedMode/effectiveMode/escalations）的 Zod schema；同步扩展 `packages/repository/src/investigation/types.ts`：FallbackReason code 追加 `wiki_missing/wiki_stale/wiki_broken`，InvestigationResult 增可选 `findings/mode` 字段（对齐 data-model.md §1–§5）
- [x] T004 实现模式裁决 `packages/repository/src/evidence/rules.ts`：resolveMode（auto 默认/fast 不豁免高风险/verify 恒定）+ 模式级高风险语义表（公共 API 增删 / Service / DB Schema `schema|migrations` / Authentication `auth|login|token|session` / Payment `payment|billing|charge|invoice` / 大范围 Refactor 删除类动词）→ escalations 记录（命中规则 + 原因）；M1 `detectHighRisk` 引用级表保持零改动（research.md D2）
- [x] T005 [P] 实现置信度规则表 `packages/repository/src/evidence/confidence.ts`：evaluateConfidence（证据构成/冲突/模式）→ `{ confidence, reason }`——未决冲突或全部未复核 → low；fast 封顶 medium；verified 多源一致 → high；其余 medium（research.md D6）
- [x] T006 [P] Foundational 单元测试：`packages/repository/src/evidence/rules.test.ts`（模式矩阵：3 模式 × 高风险命中/不命中 × 升级记录）与 `packages/repository/src/evidence/confidence.test.ts`（规则表全分支：low/medium/high 边界、fast 封顶、冲突压低）

**⚠️ CRITICAL**: T003–T006 完成前不得开始任何用户故事

**Checkpoint**: 规则表可用可测——模式与置信度判定确定性成立

---

## Phase 3: User Story 1 - 结论带证据链 (Priority: P1) 🎯 MVP

**Goal**: investigate 输出 findings：statement + evidence[] + confidence
+ confidenceReason，M1 references 兼容保留

**Independent Test**: quickstart A 段——本仓库 investigate "FleetError
在哪里定义"，findings 的 verified 证据 100% 锚定磁盘位置（SC-001），
重复执行判定一致（SC-003）

- [x] T007 [US1] 实现 Finding 合成 `packages/repository/src/evidence/resolver.ts`：四类模板（符号/文件组/wiki/insufficient，research.md D1）+ config 重分类（CONFIG_EXTENSIONS 命中 → source=config，D5）+ 单 finding evidence 上限 10 条截断标注（D10）；输入 references（M1）+ wiki 证据（US3 接入前的空位参数），输出 Finding[]（依赖 T003、T005）
- [x] T008 [US1] 扩展 investigate 编排 `packages/repository/src/investigation/investigate.ts`：流水末端接入 resolver → findings + mode 并入结果（默认 auto；verify 语义下 M1 行为不变——全部锚定复核照旧）；锚点偏移（verifyAnchor conflict）同步生成 EvidenceConflict 挂靠符号 finding（依赖 T004、T007）
- [x] T009 [US1] CLI 渲染 `apps/cli/src/commands/repo.ts`：文本模式 findings 段（`[confidence] statement` + 来源计数 + 冲突行）；`--json` 含 findings/mode；事件 payload 增 findingsCount/effectiveMode/confidence（可选字段，M1 断言不破，依赖 T008）
- [x] T010 [US1] US1 测试：单元 `packages/repository/src/evidence/resolver.test.ts`（分组确定性/模板文案/config 重分类/上限截断/insufficient）+ e2e `tests/cli/investigate-evidence.test.ts` 起步（本仓库与夹具：findings 存在且 statement 可读、verified=true 证据锚定抽查自动化（SC-001）、同命令双跑输出一致（SC-003）、M1 字段回归——references/fallbacks/summary 原样）

**Checkpoint**: US1 独立交付——证据化结论 MVP 成立

---

## Phase 4: User Story 2 - FAST / VERIFY 调查模式 (Priority: P2)

**Goal**: `--mode auto|fast|verify` 贯穿编排；高风险与零命中自动升级

**Independent Test**: quickstart B 段——同问题 fast vs verify 证据构成
对照；高风险六类在默认与显式 fast 下 100% verify（SC-002）；fast
耗时 ≤ verify（SC-006）

- [x] T011 [US2] investigate 模式贯穿 `packages/repository/src/investigation/investigate.ts`：fast 跳过 verifyAnchor 强制锚定（codegraph 证据 verified=false，D3）；三种自动升级（高风险/加速源零命中/加速源不可用）记 modeEscalation 并走 VERIFY 全链；FAST 空结果输出 verify 建议、退出码 0（FR-008）（依赖 T004、T008）
- [x] T012 [US2] CLI `--mode` 接线 `apps/cli/src/commands/repo.ts`：选项透传 + 文本模式升级记录渲染（`↗ 模式升级(rule)：detail`）（依赖 T011）
- [x] T013 [US2] US2 测试：e2e 扩展 `tests/cli/investigate-evidence.test.ts`——fast（verified=false + confidence ≤ medium）vs verify（source 复核层）对照；高风险六类矩阵（T002 夹具锚定）默认 + 显式 fast 双调用断言 effectiveMode=verify + escalations 含 high_risk（SC-002 主证据）；fast durationMs ≤ verify（SC-006 计时断言，允许相等）

**Checkpoint**: Token 与可信度分档成立——高风险不可豁免

---

## Phase 5: User Story 3 - Wiki 接入与冲突裁决 (Priority: P3)

**Goal**: wiki 成为调查加速源（三态降级）；冲突 Static Truth 胜出且留痕

**Independent Test**: quickstart C/D 段——wiki 命中出 wiki 证据；整删
wiki 前后 investigate 一致（SC-004）；冲突注入两类 100% 裁决（SC-005）

- [x] T014 [P] [US3] 实现 wiki 证据源 `packages/repository/src/evidence/wiki-source.ts`：包装 M2 queryWiki；三态判定（index 缺失 → wiki_missing；loadWikiPages 解析失败 → wiki_broken；git HEAD ≠ index 锚点 → wiki_stale，复用 M2 status 判定）→ FallbackReason；命中 → wiki Evidence（location=页面路径、verified=页面存在、excerpt=命中片段）；stale 不使用（过期知识不冒充，research.md D4）
- [x] T015 [US3] investigate 接入 wiki 阶段 `packages/repository/src/investigation/investigate.ts`：fast/verify 两路径的首个加速源（fast 有 wiki 命中即参与证据；verify fresh 才使用）；pathsUsed 增 'wiki'；wiki 命中喂给 resolver 的 wiki finding 模板（依赖 T007、T014）
- [x] T016 [US3] 冲突检测补全：锚点偏移已挂 finding（T008）之上，增加 wiki 死路径检测——wiki 命中片段提取路径 token（复用 M2 validator extractPathTokens）→ 磁盘不存在 → EvidenceConflict{kind: dead_path} 挂 wiki finding，胜出方 static_truth（research.md D7；依赖 T015）
- [x] T017 [US3] US3 测试：单元 `packages/repository/src/evidence/wiki-source.test.ts`（四态：fresh 命中/missing/stale/broken，MemoryFileSystem + FakeWikiGit 注入）+ e2e 扩展——夹具 build wiki 后调查含 wiki 证据与 wiki finding；**整删 `.fleet/wiki` 前后 references/退出码一致（SC-004 集成后重钉）**；stale wiki → wiki_stale 降级且不使用；冲突注入：FakeCodeGraphAdapter 偏移行号 → anchor_offset + 源码胜出，构造 wiki 死路径页 → dead_path（SC-005 两类主证据）

**Checkpoint**: Phase A 三层加速结构闭环——Repository Intelligence 0.1 能力面齐备

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T018 [P] 更新根 `README.md`：investigate `--mode` 用法、findings/confidence 语义、高风险升级说明，进度更新至 M3（Phase A 收官），链接 specs/004-m3-evidence-system/quickstart.md
- [ ] T019 按 quickstart.md 全景走查并记录：本仓库 SC-001 锚定抽查、SC-003 双跑一致、SC-006 计时、SC-004 隔离对照、C 段三态降级手工走查；问题回流修复后 `pnpm check` 全绿并按逻辑组提交 git
- [ ] T020 Phase A 收官核查：对照 roadmap §5 Repository Intelligence 0.1 release gate 逐项记录达成状态（Wiki/CodeGraph/Fallback/Evidence 四能力 + MCP 暴露项标注"M12 落地"）；宪法合规复查（I/V/VI 重点：加速器非依赖、确定性、零新增依赖）并更新 README 进度声明

---

## Dependencies

### Phase Completion Order

- **Setup (Phase 1)** → **Foundational (Phase 2)** → 阻塞全部故事
- **US1 (Phase 3)**：依赖 T003–T006；不依赖 US2/US3
- **US2 (Phase 4)**：依赖 US1 的编排扩展（T008）——同文件（investigate.ts）顺序推进
- **US3 (Phase 5)**：T014（wiki-source）只依赖 Foundational，**可与 US1 并行先行**；T015/T016 依赖 T007 + T014 + T008
- **Polish (Phase 6)**：依赖全部故事完成

### Within Each User Story

- Foundational：实体（T003）先于规则（T004/T005 并行）先于测试（T006）
- US1：resolver（T007）先于编排接入（T008）先于 CLI（T009）先于 e2e（T010）
- US2：编排贯穿（T011）先于 CLI（T012）先于矩阵 e2e（T013）
- US3：wiki-source（T014 可提前）→ investigate 接入（T015）→ 冲突补全（T016）→ 四态 + 注入测试（T017）

### Parallel Opportunities

- Phase 1: T002；Phase 2: T005/T006 并行（T003 之后，T006 需 T004/T005 完成后跑全矩阵）
- 跨故事：T014（US3 wiki-source）与 US1 全阶段并行（不同文件、只依赖 Foundational）
- 单人开发按 P1→P2→P3 顺序推进即可（T014 可在 US1 期间穿插）

---

## Parallel Example: US1 期间

```bash
# 三个不同文件、无相互依赖，可同时启动：
Task: "Finding 合成 packages/repository/src/evidence/resolver.ts"
Task: "wiki 证据源 packages/repository/src/evidence/wiki-source.ts"
Task: "README 更新（Polish T018 可穿插）"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + Phase 2 → 规则表与实体就绪
2. Phase 3（US1）→ findings 端到端
3. **STOP and VALIDATE**: 本仓库 investigate + SC-001 锚定抽查 + SC-003 双跑（T010）后即为可演示 MVP

### Incremental Delivery

1. US1 → 证据化结论（MVP）
2. US2 → FAST/VERIFY 分档 + 高风险强制（Token 经济性）
3. US3 → wiki 接入 + 冲突裁决（Phase A 闭环）
4. Polish → README + 走查 + release gate 核查，M3 验收关闭

---

## Notes

- [P] = 不同文件且无未完成依赖
- 每完成一个任务或逻辑组做一次 git commit（分支 004-m3-evidence-system）
- 停在任一 Checkpoint 均可独立验证该故事
- 宪法红线：全链确定性无 LLM（宪法 V / FR-011）；conflict 限位置/存在性级（语义级显式排除）；M1 契约只增不改（references/fallbacks/退出码/事件既有字段零回归）；wiki 三态只降级不失败（宪法 I）；零新增第三方依赖（宪法 VI）
- e2e 涉及 wiki 的场景一律在 tmp 夹具仓库执行（沿用 M2 惯例：不向本仓库 `.fleet/` 写测试产物；本仓库真实走查只在 T019）
- 避免：模糊任务、同文件冲突（investigate.ts 的 T008/T011/T015/T016 必须顺序执行）、跨故事依赖破坏独立性
