# Tasks: M7 五角色 Agent + 真实 Runtime（认知角色落地与权限强制）

**Input**: Design documents from `/specs/008-m7-agents-real-runtime/`

**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/ ✅ quickstart.md ✅

**Tests**: 包含测试任务——SC-001（替换自由度）/ SC-002（权限矩阵
100%）/ SC-003（替身矩阵 + 无孤儿）/ SC-004（pi 真实 e2e 探测
启用）/ SC-006（四条款复测）全部以自动化为验收证据。

**Organization**: 按 spec 用户故事分组（US1 五角色定义与运行时
注册 P1 / US2 真实 RuntimeAdapter P2 / US3 权限强制 P3）。权限
矩阵 / 角色定义 / CLI 基座放 Foundational——阻塞全部故事。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、无未完成依赖）
- **[Story]**: 所属用户故事
- 所有路径相对仓库根

---

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 同步 main 至 007 后创建并切换实现分支 `008-m7-agents-real-runtime`；初始化 `packages/agents` 包：package.json（@fleet/agents，依赖 @fleet/mission + @fleet/scheduler + @fleet/runtime + @fleet/core）、tsconfig / tsup（对齐模板）、空 `src/index.ts`，纳入 vitest projects
- [x] T002 [P] 创建替身脚本 `tests/fixtures/fake-clis/`（可执行）：`ok.sh`（回显全部参数——断言 prompt/权限段到达 CLI）、`fail.sh`（stderr 信息 + exit 1）、`slow.sh`（写 pid 文件到指定路径 + sleep 300——timeout/cancel kill 与孤儿断言载体）、`big-output.sh`（输出 >64KB）、`spawner.sh`（派生子 sleep——进程组 kill 覆盖孙进程）

**Checkpoint**: 包可构建、替身可执行（PATH 注入即用）

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 权限单一来源、角色定义、CLI 基座——所有故事的地基

- [x] T003 实现权限矩阵 `packages/agents/src/policy.ts`：Permission 枚举（READ_ONLY/LIGHT_WRITE/DEEP_WRITE）、ROLE_PERMISSIONS 常量（宪法 II 矩阵：reflex=LIGHT_WRITE / focus·insight·wisdom=READ_ONLY / reason=DEEP_WRITE）、`assertRequestPermission(request)`（env.FLEET_PERMISSION 缺失或非法 → 结构化拒绝理由）；同步在 `packages/runtime/src/fake.ts` 的 execute 入口接入同一校验（Fake 走真实链路，research.md D3）（依赖 T001）
- [x] T004 [P] 实现角色定义 `packages/agents/src/definitions.ts`：五角色 AgentDefinition（role/permission ← policy/systemPromptSegment 职责提示/outputHint 输出形态提示），提示语义锚定 roadmap（reflex 快速分诊 / focus 定位调查 / reason 规划实现 / insight 验证取证 / wisdom 审阅裁决）（依赖 T003）
- [x] T005 实现 CLI 基座 `packages/runtime/src/cli-adapter.ts`：CliRuntimeAdapter（配置 command + buildArgs + versionArgs）——execute 入口 assertRequestPermission（裸请求不启子进程）；execa spawn（detached + stdin ignore + cwd）；三路竞争单次 settle（进程退出 / timeoutMs → `kill(-pid, SIGKILL)` 组杀 → timeout / cancel → 组杀 → cancelled）；stdout 截断 64KB + 标注、stderr 首行进 detail、非零退出 → error 码；inflight/runId 映射（research.md D4）；输出截断常量与工具
- [x] T006 [P] 实现探测 `packages/runtime/src/availability.ts`：probeRuntime(name) → RuntimeAvailability（命令存在 + `--version` 首行 + installHint）；fake 名义恒可用（依赖 T005）

**⚠️ CRITICAL**: T003–T006 完成前不得开始任何用户故事

**Checkpoint**: 权限可断言、CLI 可脚本化驱动——地基闭环

---

## Phase 3: User Story 1 - 五角色定义与运行时注册 (Priority: P1) 🎯 MVP

**Goal**: 注册表驱动 role→runtime，替换零改 Scheduler/bridge/
mission（验收锚点）

**Independent Test**: quickstart A 段——注册表矩阵测试 + 同一
mission 两种注册零改动断言

- [x] T007 [US1] 实现注册表 `packages/agents/src/registry.ts`：RuntimeRegistry（resolve(role) 未注册明确报错含角色名；fromSpec(specs) 解析 `--runtime` 产物——全局名 / role=name 覆盖 / 缺省全 fake 工厂；多对一合法；自定义命令名注册——替身可充当"某真实 CLI"）（依赖 T005、T006）
- [x] T008 [US1] 实现角色执行器 `packages/agents/src/executor.ts`：AgentTaskExecutor implements TaskExecutor——execute(task)：定义查取（提示+权限必经 policy）→ registry.resolve(agentRole) → RuntimeRequest（prompt = `[{role} · {permission}] {systemPromptSegment}\n[任务 {id}] {goal}`；env = ROLE + PERMISSION；timeout 三档推导 / runId 每执行唯一 / agentId 同 M6）；记录 requests（含 runtime 名义 + permission，SC-005 载体）/ taskTimings / perTaskTimeoutMs（依赖 T004、T007）
- [x] T009 [US1] 单元测试：`packages/agents/src/policy.test.ts`（矩阵对宪法 II 逐项断言 SC-002 前半；裸请求拒绝 100%）+ `packages/agents/src/registry.test.ts`（缺省/覆盖/多对一/未注册报错/自定义命令名）+ `packages/agents/src/executor.test.ts`（请求字段含 ROLE+PERMISSION+角色片段/timeout 三档/记录形态/只读角色请求不含写授权 SC-002 后半）（依赖 T008）

**Checkpoint**: US1 独立交付——角色×运行时解耦成立（替换自由度就绪）

---

## Phase 4: User Story 2 - 真实 RuntimeAdapter (Priority: P2)

**Goal**: 三薄适配器 + 替身矩阵全绿 + pi 真实端到端

**Independent Test**: quickstart B/D 段——cli-adapter.test 替身
矩阵；pi e2e 探测启用

- [x] T010 [US2] 实现三适配器 `packages/runtime/src/pi.ts` + `codex.ts` + `gemini.ts`：薄配置继承 CliRuntimeAdapter——pi 实测参数（`-p --mode text --no-session --append-system-prompt "<角色片段+权限约束>" -- <prompt>`）；codex/gemini 按公开形态落参数模板（非交互 + system prompt 注入，探测校准制 research.md D5）；权限约束翻译 = 提示词权限段 + CLI 特定 flag（有则加）（依赖 T005、T004——权限段格式）
- [x] T011 [US2] 替身矩阵测试 `packages/runtime/src/cli-adapter.test.ts`：受控 PATH + 自定义命令名注册替身——成功（ok.sh 回显断言 prompt 与权限段到达）/ 非零退出（exit+stderr 摘要）/ 超时 kill（slow.sh：kill 后 settle timeout）/ cancel 毫秒级组杀 / **无孤儿**（slow.sh pid 文件 + spawner.sh 孙进程，kill 后轮询 pid 不存在）/ 输出截断 64KB / 裸请求拒绝（不启子进程——ok.sh 加调用计数断言零调用）/ stdin ignore（交互即超时路径）（依赖 T010、T002）
- [x] T012 [US2] 适配器 e2e `tests/cli/runtime-adapters.test.ts`：替身 PATH 下 `fleet run --runtime <替身名>`（demo 形态 mission）端到端 + **pi 真实 e2e**（probeRuntime 探测，可用则单任务 reason=pi 跑通并断言 prompt/权限到达 pi 进程参数、不可用 skip——套件恒绿 SC-004）（依赖 T011、T013 的 CLI 接线，故标注于 US3 后执行亦可）

**Checkpoint**: M6 四条款在真实进程 100% 复测（SC-006）

---

## Phase 5: User Story 3 - 权限强制与集成 (Priority: P3)

**Goal**: `fleet run --runtime` 全链路 + 不静默降级 + 可追溯

**Independent Test**: quickstart C/E 段——权限闭环 + 显式不可用
报错零执行

- [x] T013 [US3] 集成接线：`packages/runtime/src/runner.ts` 增 executor 注入点（缺省保持 M6 bridge 行为，向后兼容）；`apps/cli/src/commands/run.ts` 增 `--runtime <spec>`（可重复；全局名或 role=name；缺省 fake）——显式指定的真实运行时组装期 probeRuntime，不可用 → 退出码 1 + 探测结果与安装建议（**不静默降级，零请求发出**）；文本任务表行标注 `[runtime · permission]`；事件 payload 增 runtimes 映射；`apps/cli/src/commands/doctor.ts` 的 Agent Runtime 检查项消费 probeRuntime（codex/gemini/pi 逐项 warning 级）（依赖 T007、T008、T006）
- [x] T014 [US3] 集成测试：`tests/cli/runtime-adapters.test.ts` 扩展——替换自由度 e2e（SC-001：同一 mission 全 fake vs reason=替身 两种注册，断言 Scheduler/bridge/mission 零改动语义——两种运行均完成调度且请求差异仅来自注册）；请求流可追溯（SC-005：--json 报告/请求记录含 role→runtime→permission）；不静默降级（--runtime codex 本机未装 → 退出码 1 + 零执行）；Fake 基线回归（既有 run.test.ts 全绿零改动）（依赖 T013）

**Checkpoint**: 宪法 II 闭环——权限必达、不可绕过、可追溯

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T015 [P] 更新根 `README.md`：进度更新至 M7、`fleet run --runtime` 用法（含替换示例与不降级语义）、权限矩阵表（宪法 II）、仓库结构补 packages/agents、M7 规格链接
- [x] T016 按 quickstart.md 走查并记录（A 角色 / B 替身矩阵 / C 权限 / D 端到端含本机 pi / E 不降级）；问题回流修复后 `pnpm check` 全绿并按逻辑组提交 git

---

## Dependencies

### Phase Completion Order

- **Setup (Phase 1)** → **Foundational (Phase 2)** → 阻塞全部故事
- **US1 (Phase 3)**：依赖 T003–T007；policy→definitions→registry→executor 链
- **US2 (Phase 4)**：T010 依赖 T005 + T004（权限段格式）；T011 依赖 T010 + T002；T012 依赖 T011 + T013（CLI 接线在 US3）——**US2 与 US3 的接线互为前后件，单人顺序：T010→T011→T013→T012→T014**
- **US3 (Phase 3 序）**：T013 依赖 T007/T008/T006；T014 依赖 T013
- **Polish (Phase 6)**：依赖全部故事完成

### Within Each User Story

- Foundational：policy（T003）先于 definitions（T004 可并行）；cli-adapter（T005）与 availability（T006）并行
- US1：registry（T007）与 executor（T008）顺序（executor 用 registry）；测试（T009）殿后
- US2/US3 交错：见 Phase Completion Order 的单人顺序说明

### Parallel Opportunities

- Phase 2: T004 与 T005/T006 并行（T003 之后）
- Phase 4 的 T010 与 US1 的 T007/T008 并行（不同包不同文件）
- 单人推荐顺序：T001→T002→T003→{T004,T005,T006}→T007→T008→T009→T010→T011→T013→T012→T014→Polish

---

## Parallel Example: Phase 2 中段

```bash
# T003 完成后，三个不同文件可同时启动：
Task: "角色定义 packages/agents/src/definitions.ts"
Task: "CLI 基座 packages/runtime/src/cli-adapter.ts"
Task: "探测 packages/runtime/src/availability.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + Phase 2 → 权限/角色/基座就绪
2. Phase 3（US1）→ 注册表 + 执行器 + 矩阵测试
3. **STOP and VALIDATE**: 替换自由度断言绿（T009）后即为可演示 MVP

### Incremental Delivery

1. US1 → 角色注册（替换是配置行为）
2. US2 → 真实进程契约（kill/孤儿/截断）
3. US3 → CLI 全链路 + 不降级 + 可追溯
4. Polish → README + 走查，M7 验收关闭

---

## Notes

- [P] = 不同文件且无未完成依赖
- 每完成一个任务或逻辑组做一次 git commit（分支 008-m7-agents-real-runtime）
- 停在任一 Checkpoint 均可独立验证该故事
- 宪法红线：权限三段闭环（矩阵单一来源→请求必经 policy 注入→适配器入口拒绝裸请求，Fake 同校验）；物理 Worktree 隔离 = M8 不宣称；不静默降级 Fake；Fake 仍为 e2e 基线（真实 CLI 探测启用/跳过）；零新增依赖
- 替身脚本必须可执行（chmod +x）且它自身不依赖 bash 以外环境；pid 文件路径经 env 传入避免并行冲突
- 时序断言防抖沿用 M6 约定（小毫秒 + 量级断言）
- 避免：模糊任务、同文件冲突（run.ts 的 T013 单任务；cli-adapter.test 的 T011 在 T010 后）、跨故事依赖破坏独立性
