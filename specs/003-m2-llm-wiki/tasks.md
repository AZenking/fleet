# Tasks: M2 LLM Wiki（仓库持久知识层）

**Input**: Design documents from `/specs/003-m2-llm-wiki/`

**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/ ✅ quickstart.md ✅

**Tests**: 包含测试任务——spec 的 SC-003（逐字节增量断言）/SC-004
（stale 判定 100%）以自动化测试为主验收证据；SC-002 认知走查按
quickstart 手工执行（Polish 阶段）。

**Organization**: 按 spec 用户故事分组（US1 初始化构建导航 P1 /
US2 提问检索 P2 / US3 增量更新与 stale P3）。共享地基（front matter
与围栏格式、只读 git、实体 schema）放 Foundational——它们阻塞全部
故事。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、无未完成依赖）
- **[Story]**: 所属用户故事
- 所有路径相对仓库根

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 分支与测试夹具

- [x] T001 创建并切换实现分支 `003-m2-llm-wiki`（当前在 002-m1-codegraph-fallback；spec/plan 文档随首个实现提交一并纳入）
- [x] T002 [P] 创建 e2e 夹具助手 `tests/helpers/git-repo-fixture.ts`：在 tmp 目录组装 git 仓库（复制 `tests/fixtures/sample-repo` 内容 + `git init` + 两次可控提交 + 可注入后续提交/改文件动作），供 wiki e2e 使用（M1 夹具无 git 历史，本里程碑需要可控 diff）

**Checkpoint**: 分支就绪、夹具可组装出带两个提交的 tmp 仓库

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 实体 schema、磁盘格式层、只读 git——所有故事的地基

- [x] T003 定义 wiki 实体与 schema `packages/repository/src/wiki/types.ts`：WikiMetadata（front matter：title/generated_from/updated_at/scope）、WikiPage（含 origin 推导值）、PageFreshness、WikiStatus、BuildResult/UpdateResult、ValidationReport（code 枚举 8 项）、WikiQueryResult/WikiHit 的 Zod schema 与类型（对齐 data-model.md）
- [x] T004 实现磁盘格式层 `packages/repository/src/wiki/format.ts`：front matter 解析（首 `---` 块 split + yaml 库）与序列化往返；generated 围栏解析（`<!-- fleet:generated -->` 成对提取 → generatedBlocks/manualContent）与页面重组（围栏内替换、围栏外原样）；origin 三态推导（research.md D1/D2，对齐 contracts/wiki-format.md）
- [x] T005 [P] 实现只读 git `packages/repository/src/wiki/git.ts`：GitPort 接口（headSha / changedFiles(fromSha)）+ execa 实现；**严格错误语义**——失败返回结构化错误而非空（区别于 fallback/git.ts 的容错辅助，research.md D4 前置）；测试可注入假实现
- [x] T006 [P] 格式层单元测试 `packages/repository/src/wiki/format.test.ts`（MemoryFileSystem + 假 git 注入）：front matter 往返、围栏配对/未配对（unpaired_fence）、origin 三态矩阵、重组后围栏外人工区逐字节保留

**⚠️ CRITICAL**: T003–T006 完成前不得开始任何用户故事

**Checkpoint**: 格式层可用可测——页面读写、围栏保护、git 锚定全部就绪

---

## Phase 3: User Story 1 - 初始化、构建与导航 (Priority: P1) 🎯 MVP

**Goal**: `fleet wiki init` + `fleet wiki build` 产出带元数据、可导航、
0 死链的真实知识库

**Independent Test**: quickstart A 段——本仓库 init+build ≤30s（SC-001），
front matter 三要素齐全、index 收录全部页面、反引号路径 100% 锚定
（FR-004）

- [x] T007 [US1] 实现 init `packages/repository/src/wiki/generator/skeleton.ts`：initWiki() 幂等建骨架（index + architecture/domains/infrastructure/decisions 分区 + glossary，仅补缺失文件，已有内容与人工页面原样保留，FR-001）
- [x] T008 [US1] 实现事实提取 `packages/repository/src/wiki/generator/skeleton.ts`：monorepo 探测（pnpm-workspace.yaml / package.json workspaces）→ domains/ 每包一页（描述、内部/外部依赖、scripts、目录结构、入口 index.ts 模块注释）+ architecture/overview.md（顶层结构 + 内部依赖邻接表）+ infrastructure/tooling.md（根 scripts + eslint/vitest/tsconfig 探测）+ decisions/README + glossary 骨架；非 monorepo 降级 src/ 扫描；全部路径引用来自真实扫描；文件数上限 10k 截断标注（research.md D5/D11）；scope 按页面语义设定（overview=`.`、包页=`packages/<包>` 等）
- [x] T009 [P] [US1] 实现 index 生成 `packages/repository/src/wiki/index-writer.ts`：页面清单 → 层级导航 index.md（分区 → 页面链接 + 一行描述），含合法 front matter；index_out_of_sync 判定依据（contracts/wiki-format.md）
- [x] T010 [P] [US1] 实现 Validator `packages/repository/src/wiki/validator.ts`：两级锚定（generated 区块内反引号路径 token 磁盘存在 + 全文 markdown 相对链接可达）+ 结构校验（index 存在且收录全、四分区 + glossary、front matter 字段合法、围栏配对）→ ValidationReport，人工自由文本不校验（research.md D7）
- [x] T011 [US1] 实现 build 编排 `packages/repository/src/wiki/generator/build.ts`：init 兜底 → 事实提取 → 页面写入（幂等：内容未变不写、记 pagesUnchanged）→ index 同步 → validator 内联执行 → BuildResult；非 git 仓库省略 generated_from 并在页面渲染 missing 行，退出码仍 0（FR-002，依赖 T007–T010）
- [x] T012 [US1] 注册 CLI `apps/cli/src/commands/wiki.ts` + `bin.ts` 接线：`fleet wiki init|build [--repo] [--json] [--force]`；文本/JSON 双输出、退出码 0/1/2、`wiki.init/build.completed` 事件走 stderr（对齐 contracts/cli.md；--repo 解析复用 resolveRepoRoot）
- [x] T013 [US1] US1 测试：单元（generator 事实提取——MemoryFileSystem 模拟 monorepo/非 monorepo 两形态断言条目与 scope；validator 八类错误码矩阵；index 同步）+ e2e `tests/cli/wiki.test.ts`（tmp git 夹具：init→build 结构完整、front matter 三要素、index 收录全、幂等重跑 pagesUnchanged 覆盖全页、非 git 目录 build 标注 missing 退出码 0；SC-001 计时 ≤30s 断言）

**Checkpoint**: US1 独立交付——知识库 MVP 成立（本仓库可演示）

---

## Phase 4: User Story 2 - 提问检索 (Priority: P2)

**Goal**: `fleet wiki query` 确定性检索 + 可解释排序 + 状态语义矩阵

**Independent Test**: quickstart B 段——命中 ≤2s（SC-006）、空结果 +
suggestions 退出码 0、wiki 缺失退出码 1 + 修复指引（FR-005/006）

- [x] T014 [P] [US2] 实现检索 `packages/repository/src/wiki/query.ts`：关键词提取（停用词过滤 + 标点/空格分词 + 中文 bigram）→ 复用 M1 `searchPatterns`（repoRoot 指向 wiki 根，rg→walk 降级链照常）→ 页面聚合排序（标题×3 + 小节标题×2 + 正文命中行×1，同分按路径字典序）→ WikiQueryResult（含 scoreBreakdown）；suggestions 从 index 页面标题全集提取（research.md D6）
- [x] T015 [US2] query 状态语义与 CLI 子命令 `apps/cli/src/commands/wiki.ts` 扩展：wiki 缺失/index 损坏 → 退出码 1 + 修复指引；stale → 轻量检查（git headSha ≠ 最新页 generated_from 即警告，页面级明细归 US3 status）+ 照常检索；空结果 → suggestions + 退出码 0；`--max-hits`（默认 10）/`--json`/`--repo`；`wiki.query.completed` 事件（依赖 T014、T012 的命令骨架）
- [x] T016 [US2] US2 测试：单元（排序确定性——同输入同序、中文 bigram 命中、scoreBreakdown 正确、rg 缺失 forceWalk 降级仍出结果）+ e2e（tmp 夹具 build 后：命中/空结果/缺 wiki 三态退出码矩阵、--json 结构断言、命中 ≤2s SC-006 计时断言）

**Checkpoint**: Wiki 的价值出口打通——Token 效率路径成立

---

## Phase 5: User Story 3 - 增量更新与 stale 识别 (Priority: P3)

**Goal**: `fleet wiki status`/`update` 页面级 stale 判定与零污染增量重算

**Independent Test**: quickstart C 段——status 页面级命中/未命中断言
100% 准确（SC-004）；update 受影响页 100% 刷新、无关页逐字节不变
（SC-003）；mixed 页人工区保留 + .backup 出现（FR-009）

- [x] T017 [P] [US3] 实现 stale 判定 `packages/repository/src/wiki/status.ts`：headSha + `diff --name-only <generated_from> HEAD` → 页面级 stale（changed files ∩ scope 前缀匹配）→ WikiStatus（state/aheadCommits/changedFiles/pages 明细/fullRebuildRecommended>70%）；generated_from 缺失或非 git → unknown，不猜测（research.md D4，SC-004 纯集合运算；依赖 T005）
- [x] T018 [US3] 实现增量更新 `packages/repository/src/wiki/updater.ts`：受影响页按 origin 分派——generated 整页重算 / mixed 仅围栏内重写（写入前备份至 `.fleet/wiki/.backup/`，滚动保留一代）/ manual 跳过并提示；未受影响页零触碰；index 同步；UpdateResult（依赖 T008 单页生成、T017）
- [x] T019 [US3] CLI status/update 子命令 `apps/cli/src/commands/wiki.ts` 扩展：status 恒退出码 0（fresh/stale/unknown 均有效）+ fullRebuild 建议；update 退出码 0/1 + manual 页跳过提示；`wiki.status/update.completed` 事件（依赖 T017、T018）
- [x] T020 [US3] US3 测试（SC-003/SC-004 主证据，e2e `tests/cli/wiki.test.ts` 扩展）：tmp 夹具基线 build → 改 `packages/repository` 下文件提交 → status 断言页面级命中（domains/repository、overview）/未命中（domains/core）→ update 后 `git diff` 断言受影响页 100% 刷新、无关页 0 字节变化；mixed 页人工区逐字节保留 + .backup 出现；manual 页跳过；fresh/stale/unknown 三态矩阵（非 git 夹具）

**Checkpoint**: 持久层生命周期闭环——M2 全部故事独立可用

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T021 [P] 更新根 `README.md`：新增 `fleet wiki` 五命令用法、页面格式（围栏/scope）一段说明，链接 specs/003-m2-llm-wiki/quickstart.md
- [ ] T022 [P] 隔离对照验证（宪法 I / SC-005）：e2e 增加"建 wiki 前后 `fleet repo investigate` 输出一致"断言 + `fleet doctor` 不受 wiki 状态影响断言；确认 investigate 排除目录含 `.fleet` 零改动
- [ ] T023 按 quickstart.md 全景走查并记录：本仓库 SC-001 计时、SC-002 认知走查 5 题（≥4/5）、C 段增量与人工保护、D 段隔离对照；问题回流修复后 `pnpm check` 全绿并按逻辑组提交 git

---

## Dependencies

### Phase Completion Order

- **Setup (Phase 1)** → **Foundational (Phase 2)** → 阻塞全部故事
- **US1 (Phase 3)**：依赖 T003–T006（格式层 + git）；不依赖 US2/US3
- **US2 (Phase 4)**：依赖 US1 的 build 产物与命令骨架（T012）；query.ts 本身可与 US1 后期并行
- **US3 (Phase 5)**：依赖 T005（严格 git）与 T008（单页生成复用）；status.ts（T017）只依赖 Foundational，可提前并行
- **Polish (Phase 6)**：依赖全部故事完成

### Within Each User Story

- Foundational：契约（T003）先于格式实现（T004）；git（T005）与格式测试（T006）并行
- US1：T007/T008 顺序同文件；T009/T010 可并行；编排（T011）先于 CLI（T012）先于 e2e（T013）
- US3：T017 可与 US1/US2 并行先行；T018 依赖 T017 + T008；e2e（T020）殿后

### Parallel Opportunities

- Phase 1: T002；Phase 2: T005/T006 并行（T003 之后）
- US1: T009/T010 并行（T008 之后）
- 跨故事：T014（US2 query）与 T017（US3 status）互不依赖，可在 US1 完成后并行
- 单人开发按 P1→P2→P3 顺序推进即可

---

## Parallel Example: US1 完成后

```bash
# 三个不同文件、无相互依赖，可同时启动：
Task: "检索 packages/repository/src/wiki/query.ts"
Task: "stale 判定 packages/repository/src/wiki/status.ts"
Task: "README 更新（Polish T021 可穿插）"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + Phase 2 → 格式层与 git 锚定可用
2. Phase 3（US1）→ init/build/导航端到端
3. **STOP and VALIDATE**: 本仓库 init+build + quickstart A 段锚定抽查（T013 + SC-001 计时）后即为可演示 MVP

### Incremental Delivery

1. US1 → 知识库载体（MVP）
2. US2 → 提问检索（价值出口）
3. US3 → 增量更新 + stale（生命周期闭环）
4. Polish → README + 隔离对照 + 全景走查，M2 验收关闭

---

## Notes

- [P] = 不同文件且无未完成依赖
- 每完成一个任务或逻辑组做一次 git commit（分支 003-m2-llm-wiki）
- 停在任一 Checkpoint 均可独立验证该故事
- 宪法红线：wiki 代码只写 `.fleet/wiki/`（含 .backup），不得触碰源码与 `.codegraph`；不得引入向量库或任何新第三方依赖（宪法 VI）；build/update/status 判定全确定性，无 LLM 运行时调用（FR-011）
- e2e 一律在 tmp 夹具仓库执行（不向本仓库 `.fleet/wiki` 写测试产物）；本仓库真实走查只在 Polish（T023）手工执行
- 避免：模糊任务、同文件冲突、跨故事依赖破坏独立性
