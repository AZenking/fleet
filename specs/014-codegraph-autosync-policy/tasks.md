# Tasks: CodeGraph 索引自动维护策略（stale→sync / uninitialized→init）

**Input**: Design documents from `/specs/014-codegraph-autosync-policy/`

**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/ ✅ quickstart.md ✅

**Tests**: 包含测试任务——SC-001 三档矩阵 / SC-002 故障三态 /
SC-003 单次语义 / SC-004 默认零变化全量回归 / SC-005 unavailable
零维护。

## Format: `[ID] [P?] [Story] Description`（路径相对仓库根）

---

## Phase 1: Foundational

- [x] T001 [P] `packages/repository/src/codegraph/maintainer.ts`：MaintainOutcome 类型 + CodeGraphMaintainer 接口 + CliCodeGraphMaintainer（execa `codegraph init|sync`，cwd=repoRoot、超时 kill→timeout、非零/启动失败→failed，异常不逃逸——contracts §1 四条款）+ FakeCodeGraphMaintainer（script 队列按调用序出队 {ok,kind?,delayMs?} 耗尽重复末项 + calls 记录）+ 单测（Cli：成功/失败/超时三态——PATH 替身脚本或 command 注入；Fake：出队与耗尽语义）；**cli-adapter.ts 零改动**（只读红线保留）
- [x] T002 [P] `packages/core/src/config/schema.ts`：fleetConfigSchema 增 `codegraph: strictObject({ autoMaintain: enum('manual','sync','auto').default('manual'), timeoutMs: 正整数十选 })`（整体 optional）+ core config 测试（合法三值/缺省/非法值拒绝/未知字段拒绝）

**⚠️ CRITICAL**: T001–T002 完成前不得开始策略挂点

---

## Phase 2: User Story 1 - 三档策略挂点 (Priority: P1) 🎯 MVP

**Goal**: investigate 健康检查处按档位触发单次维护并重查（SC-001/003/005）

- [x] T003 [US1] `packages/repository/src/investigation/types.ts` + `investigate.ts`：InvestigateOptions 增 `codegraph?: { policy; timeoutMs?; maintainer? }`（缺省 manual=现状）；健康检查处挂策略状态机（data-model §4）——unavailable 三档零维护；uninitialized+auto→init；stale+sync|auto→sync；维护 = started 事件 → maintainer（超时传入）→ completed/failed 事件 → **恰一次重查** health → fresh 则 codegraphUsable=true，否则现状降级（fallback detail 附"已尝试自动 <action>：<结果>"）；manual 档 fixSuggestion 语义不变（sync 档 uninitialized 提示需 auto）；FakeCodeGraphAdapter 增 `setHealth(next)`（测试改写健康态）
- [x] T004 [US1] `packages/repository/src/investigation/investigate.test.ts` 新增矩阵：① 三档命中路径（manual 零调用零变化断言 + pathsUsed 不含 codegraph；sync+stale→恰一次 sync→setHealth fresh→pathsUsed 含 codegraph + 零 stale fallback；auto+uninitialized→恰一次 init→命中）② 故障三态（failed/timeout/维护后仍 stale→降级完成 + fallback 含尝试信息 + 维护事件总数恰 1）③ unavailable×三档 maintainer.calls=0 ④ 事件断言（started/completed|failed 各一，payload 含 action/policy/durationMs）（依赖 T001、T003）

---

## Phase 3: User Story 2 - 调用方接线 (Priority: P2)

**Goal**: CLI 旗标 + fleet.yaml 解析；MCP 同语义（spec US1 场景 5 / Assumptions）

- [x] T005 [US2] `apps/cli/src/commands/repo.ts`：`--codegraph-maintain <manual|sync|auto>` 旗标；策略解析优先级 旗标 > configs/fleet.yaml（loadFleetConfig，缺文件/缺段=manual）> 缺省；解析结果注入 investigate options；非法旗标值退出码 2
- [x] T006 [US2] `packages/mcp/src/repo-tools.ts`：repo_investigate 读目标仓库 configs/fleet.yaml（缺=manual）注入同语义；mcp 单测补一条（配置存在时 payload/行为不变——策略经 investigate 生效，工具层仅解析透传）

---

## Phase 4: Polish

- [x] T007 [P] 全量回归（lint/format/build/test 零失败 = SC-004 默认零变化）；configs/fleet.yaml 样例注释 + docs/tutorial.md 常见问题补一段（自动维护策略三档说明）；本机真机 smoke（codegraph 1.4.1：配置 sync 档跑一次 repo investigate，事件含 codegraph.sync.*）；提交 milestone commit

---

## Dependencies & Execution Order

T001 ∥ T002 → T003 → T004 → T005/T006（可并行）→ T007

## Implementation Strategy

MVP = T001–T004（策略核心 + 矩阵）→ 接线（T005/T006）→ 回归收束

## Notes

- 降级链代码路径零改动是硬约束——维护只发生在 codegraphUsable
  判定之前（contracts §2）
- Fake.setHealth 是唯一为测试新增的既有类方法（只进 Fake，不进
  契约接口）
