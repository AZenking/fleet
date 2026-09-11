# Tasks: M8 Workspace + Git Worktree（物理工作区隔离）

**Input**: Design documents from `/specs/009-m8-workspace-worktree/`

**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/ ✅ quickstart.md ✅

**Tests**: 包含测试任务——SC-001 生命周期 / SC-002 三段式并行隔离
（验收锚点）/ SC-003 六类故障 / SC-005 物理范围断言全部以自动化
为验收证据；e2e 全程 tmp git 仓库（不触碰本仓库）。

**Organization**: 按 spec 用户故事分组（US1 工作区生命周期 P1 /
US2 并行隔离与集成 P2 / US3 故障矩阵与恢复语义 P3）。实体 /
受控 git / 管理器放 Foundational——阻塞全部故事。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、无未完成依赖）
- **[Story]**: 所属用户故事
- 所有路径相对仓库根

---

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 同步 main 至 008 后创建并切换实现分支 `009-m8-workspace-worktree`；初始化 `packages/workspace` 包：package.json（@fleet/workspace，依赖 @fleet/core + @fleet/runtime + @fleet/mission + @fleet/scheduler）、tsconfig / tsup（对齐模板）、空 `src/index.ts`，纳入 vitest projects
- [x] T002 [P] 创建写动作替身 `tests/fixtures/fake-clis/write-cli.sh`：`--version` 探测友好（exit 0）；实际执行在 cwd 写文件（env `FAKE_WRITE_FILE` / `FAKE_WRITE_CONTENT` 指定目标）——e2e 并行隔离的写行为载体

**Checkpoint**: 包可构建、写替身可执行

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 实体、受控 git、管理器——所有故事的地基

- [x] T003 定义实体 `packages/workspace/src/types.ts`：Workspace（taskId/runId/path/branch/baseline/status 五态）、MergeOutcome（merged{commit} | conflict{files} | noop | rejected{reason}）、DestroyOutcome（ok/residual[]）、WorkspaceFault 七码（not_a_git_repo/empty_repo/dirty_main/branch_collision/limit_exceeded/cleanup_partial/git_failed）、WorkspaceInventory 与 OrphanEntry（对齐 data-model.md §1–§6）
- [x] T004 实现受控 git `packages/workspace/src/git.ts`：runGit(cwd, args)（execa、超时 5s、stdin ignore、非零/超时 → 结构化 git_failed fault，stderr 首行进 detail）；git 检查原语（isGitRepo / headSha / isClean / branchExists / worktreeList）（依赖 T003）
- [x] T005 实现管理器 `packages/workspace/src/manager.ts`：GitWorktreeManager（repoRoot, options {maxWorktrees=8}）——create（五重前置校验 → `worktree add -b fleet/<runShort>/<taskId> .fleet/worktrees/<runShort>-<taskId> HEAD`，runShort = runId 去 run_ 前缀 8 位、缺省 adhoc；活动清单登记）；getDiff（`add -A -N` → `diff HEAD`）；merge（隔离区 commit（空→noop）→ 主仓 `merge --no-ff`，冲突解析 CONFLICT 清单 + `merge --abort` 双方回 pre-merge）；destroy（`worktree remove --force` + `branch -D`，幂等 + 部分失败 residual 报告）（依赖 T004，research.md D2/D3）

**⚠️ CRITICAL**: T003–T005 完成前不得开始任何用户故事

**Checkpoint**: 四操作可用——生命周期可驱动

---

## Phase 3: User Story 1 - 工作区生命周期 (Priority: P1) 🎯 MVP

**Goal**: create→写→diff→merge→destroy 全链在 tmp 仓库绿（SC-001）

**Independent Test**: quickstart A 段——单元测试 + node 演示脚本

- [x] T006 [US1] 生命周期单元测试 `packages/workspace/src/manager.test.ts`：tmp git 夹具（beforeAll init + 基线提交，afterAll 清理）——create 返回形态（路径/分支/基线=HEAD）与目录真实存在；写文件后 getDiff 含变更（**未跟踪新文件亦含**）；merge 后主分支文件可见 + merged 提交号；destroy 后目录与分支消失 + 主仓干净；空 diff merge = noop；二进制文件 diff 有标注；destroy 幂等（重复调用 ok）；同 taskId 二次 create = branch_collision（依赖 T005）

**Checkpoint**: US1 独立交付——WorkspaceManager MVP 成立

---

## Phase 4: User Story 2 - 并行隔离与集成 (Priority: P2)

**Goal**: fleet run 写角色在 worktree 执行、只读在主仓根；验收锚点三段式

**Independent Test**: quickstart B/C 段——SC-005 物理范围断言 +
SC-002 三段式

- [x] T007 [US2] 两处小扩展：`packages/agents/src/executor.ts` 的 config.cwd 支持 `(task: Task) => string` resolver（构造请求时 resolve，向后兼容字符串）；`packages/runtime/src/fake.ts` 构造选项 `touchOnSuccess?: string[]`（成功路径在 request.cwd 写相对路径文件——单测写行为替身，research.md D5）
- [x] T008 [US2] 实现处置装饰器 `packages/workspace/src/executor.ts`：WorkspaceResolvingExecutor implements TaskExecutor——execute(task)：READ_ONLY（ROLE_PERMISSIONS，M7 单一来源）→ inner 直通（cwd=repoRoot）；写授权 → manager.create（runId 传入）→ inner（cwd 查表）→ 按结果处置（成功 merge / 失败 destroy；policy `auto` | `keep-on-finish`）；处置进 dispositions 记录面；create 故障 → 任务失败（detail=fault code）不击穿（依赖 T005、T007）
- [x] T009 [US2] 集成测试 `packages/workspace/src/executor.test.ts`：tmp 仓库 + Fake touchOnSuccess——SC-005 断言（只读角色请求 cwd=主仓根、reason/reflex 请求 cwd=各自 worktree 路径，请求流 100% 对应）；成功 → merged + 主分支含写入文件；失败 → destroyed + worktree 目录消失；keep-on-finish → 保留；串行依赖（A→B）→ B 的 worktree 基线含 A 已合并变更（批次屏障红利断言，research.md D6）；双 reason 并行（Promise.all）→ 互不可见（依赖 T008）
- [x] T010 [US2] run 集成接线：`packages/runtime/src/runner.ts` RunReport 增可选 `workspaces`（duck-typing 读取执行器 dispositions）+ RunnerOptions 增 repoRoot 透传；`apps/cli/src/commands/run.ts` 默认装配 WorkspaceResolvingExecutor（GitWorktreeManager + AgentTaskExecutor cwd resolver 查表）、`--no-worktree` 回退 M7 行为；文本报告追加工作区处置行（依赖 T008）

**Checkpoint**: 验收锚点就绪——并行执行物理隔离成立

---

## Phase 5: User Story 3 - 故障矩阵与恢复语义 (Priority: P3)

**Goal**: 六类故障 100% 结构化；孤儿检测与最小清理

**Independent Test**: quickstart D 段——故障矩阵单元 + e2e run 中
故障不击穿

- [x] T011 [US3] 故障矩阵单元测试 `packages/workspace/src/manager.test.ts` 扩展：dirty 主仓（拒绝 + detail 含首个脏文件）；残留同名分支（collision）；空仓 / 非仓库目录；上限触发（maxWorktrees=1 第二个 create → limit_exceeded）；merge 冲突（主仓同位置改 → conflict{files} + 双方 pre-merge 状态保持 + 可 destroy）；清理失败注入（vi.spyOn 模拟目录删除失败 → cleanup_partial + residual）——每类 code 断言、0 崩溃、0 主仓污染（SC-003）（依赖 T006）
- [x] T012 [US3] 实现孤儿检测 `packages/workspace/src/inventory.ts`：inventory()（`git worktree list --porcelain` 中位于 .fleet/worktrees/ 且不在活动清单 → orphans）+ cleanupOrphan（destroy 同序列）；单元测试——手工残留 worktree 目录（跳过 destroy 模拟崩溃）→ inventory.orphans 命中 → cleanupOrphan → 清单归零（SC-004）（依赖 T005）
- [x] T013 [US3] e2e `tests/cli/workspace.test.ts`：tmp 仓库 + write-cli 替身（PATH 注入）——**SC-002 三段式**（双 reason 无依赖并行：50ms 轮询主仓 `git status --porcelain` 全程干净 + 两 worktree diff 互不可见 + 双 merge 后主分支两文件并存）；`--no-worktree` 回退（请求 cwd=主仓根、无 worktree 创建）；run 中 worktree 故障（残留分支注入 → 任务失败 detail 含 branch_collision）不击穿 run、报告 workspaces 字段含明细（SC-006）（依赖 T010、T002）

**Checkpoint**: 六类故障闭环——M8 全部故事独立可用

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T014 [P] 更新根 `README.md`：进度更新至 M8、fleet run 的 worktree 隔离语义（写角色隔离/只读主仓/--no-worktree/处置策略）、仓库结构补 packages/workspace、M8 规格链接
- [x] T015 按 quickstart.md 走查并记录（A 生命周期含 node 演示 / B 三段式 / C 物理范围 / D 故障 / E 回退开关）；问题回流修复后 `pnpm check` 全绿并按逻辑组提交 git

---

## Dependencies

### Phase Completion Order

- **Setup (Phase 1)** → **Foundational (Phase 2)** → 阻塞全部故事
- **US1 (Phase 3)**：只依赖 T005
- **US2 (Phase 4)**：T007（小扩展）可与 US1 并行；T008 依赖 T005+T007；T009 依赖 T008；T010 依赖 T008
- **US3 (Phase 5)**：T011 依赖 T006；T012 依赖 T005；T013 依赖 T010+T002（e2e 殿后）
- **Polish (Phase 6)**：依赖全部故事完成

### Within Each User Story

- US2：扩展（T007）→ 装饰器（T008）→ 集成测试（T009）∥ 接线（T010，T008 后）
- US3：单元矩阵（T011/T012 可并行）→ e2e（T013 殿后）

### Parallel Opportunities

- Phase 2 后：T006（US1）与 T007（US2 扩展）并行
- Phase 5 内：T011 与 T012 并行（不同文件）
- 单人推荐顺序：T001→T002→T003→T004→T005→T006→T007→T008→T009→T010→T011→T012→T013→Polish

---

## Parallel Example: Phase 3 期间

```bash
# T005 完成后，两类不同文件可同时启动：
Task: "生命周期测试 packages/workspace/src/manager.test.ts"
Task: "执行器小扩展 packages/agents/src/executor.ts + packages/runtime/src/fake.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + Phase 2 → 实体 / 受控 git / 管理器就绪
2. Phase 3（US1）→ 生命周期全绿
3. **STOP and VALIDATE**: tmp 仓库生命周期链（T006）后即为可演示 MVP

### Incremental Delivery

1. US1 → WorkspaceManager（MVP）
2. US2 → run 集成 + 并行隔离（验收锚点）
3. US3 → 故障矩阵 + 孤儿原语（鲁棒性）
4. Polish → README + 走查，M8 验收关闭

---

## Notes

- [P] = 不同文件且无未完成依赖
- 每完成一个任务或逻辑组做一次 git commit（分支 009-m8-workspace-worktree）
- 停在任一 Checkpoint 均可独立验证该故事
- 宪法红线：写授权判定必经 M7 ROLE_PERMISSIONS（单一来源，workspace 零矩阵复制）；merge 不强合（冲突 abort 双方 pre-merge）；主仓 dirty 即拒绝；跨进程完整恢复 / 巡检 CLI 属 M11 不越界；验证门（Validation 决定 merge/reject）属 M9；e2e 全程 tmp 仓库零触碰本仓库；零新增依赖
- 测试 tmp 夹具的 git 提交需显式 user.name/user.email env（CI 无全局配置）
- git 子命令超时 5s 防挂；`.fleet/` 已在根 .gitignore（M0）——主仓 status 天然不含 worktree 目录
- 避免：模糊任务、同文件冲突（manager.test 的 T006/T011 顺序扩展；executor 的 T007/T008 不同包可并行）、跨故事依赖破坏独立性
