# Tasks: M11 Observability + Recovery（可观测与恢复）

**Input**: Design documents from `/specs/012-m11-observability-recovery/`

**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/ ✅ quickstart.md ✅

**Tests**: 包含测试任务——SC-001 落盘一致 / SC-002 kill-9 中断识别
（验收锚点前半）/ SC-003 resume 零重跑（后半）/ SC-004 六命令矩阵
+ cancel / SC-005 事件全集 / SC-006 孤儿归零 / SC-007 指纹防漂移。

**Organization**: 按 spec 用户故事分组（US1 Run 持久化与事件全集
P1 / US2 观测 CLI P2 / US3 崩溃恢复与 Resume P3）。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、无未完成依赖）；所有路径相对仓库根

---

## Phase 1: Setup

- [x] T001 初始化 `packages/observability`（@fleet/observability：core + mission + workspace + budget + validation + scheduler）：package.json / tsconfig / tsup / 空 index；vitest.config.ts 增 `observability` project

**Checkpoint**: 包可构建

---

## Phase 2: Foundational

- [x] T002 [P] `packages/observability/src/sink.ts`：EventSink（emit 即时 appendFileSync，FleetEvent id/timestamp 自动，复用 core serializeEvent）+ readEvents（逐行 parse，尾半行跳过 + skippedLines 计数——SC 容错）+ 单测（流式语义：emit 后立即读可得；半行容错；空文件）
- [x] T003 [P] `packages/observability/src/store.ts` + types.ts：RunStore（beginRun：`.fleet/runs/<mission-id>/<runShort>/` 幂等建目录 + mission.json（快照 + fingerprintOf(mission)）+ events.jsonl + artifacts/ logs/ 占位；finalize：summary.json（终态/任务表/门+预算摘要/累计 attempts）/ usage.json（budget 终局）/ diff.patch / validation.json（reviews）写序与覆盖语义）+ fingerprintOf（djb2：id|taskId:role:deps）+ 单测（目录布局齐全 / 幂等 / fingerprint 对任务集变更敏感、对无关字段不敏感）
- [x] T004 `packages/scheduler`：SchedulerConfig 增 `shouldStop?: () => boolean`；run() 批次循环顶检查——stop 时 `executor.cancelAll?.()` → await 当前批 settle → pending→skipped（skippedBy='cancelled'）→ 在行未完成→cancelled → status='cancelled'（runOutcomeStatusSchema 增枚举）；types.ts TaskExecutor 增可选 `cancelAll?(): Promise<void>` + scheduler.test 增用例（shouldStop 立真 → 未开始 skipped、status cancelled；无 shouldStop 回归）
- [x] T005 `packages/agents/src/executor.ts` cancelAll 实现（in-flight runId → runtime.cancel；workspace executor 转发 inner.cancelAll）；`packages/runtime/src/cli-adapter.ts` 子进程命令行加 `env FLEET_CHILD=1` 前缀（spawn 参数而非 shell——command 改 `env` + args 前缀，保 --version 探测兼容性验证）

**⚠️ CRITICAL**: T002–T005 完成前不得开始用户故事

---

## Phase 3: User Story 1 - Run 持久化与事件全集 (Priority: P1) 🎯 MVP

**Goal**: fleet run 流式落盘 + 事件全集发射（SC-001/002/005）

- [x] T006 [US1] `packages/observability/src/view.ts`：RunStatusView——listRuns（扫 `.fleet/runs/*/*`，mission.json+events.jsonl 重建：终态/ interrupted（有 started 无终态）/ 未开始不列；任务分布 counts）+ viewRun + readSummary + 单测（完成/失败/interrupted/未开始四态矩阵；半行容错联动）
- [x] T007 [US1] run 集成 `packages/runtime/src/runner.ts`：RunnerOptions 增 `runStore?: RunStore`（缺省不落盘——库层回归零影响）+ `resume?: { completedTaskIds: string[] }`；runMissionFile——sink 汇点（mission.created/started 开局；executor 包装发射 task.queued/started/completed/failed/skipped（resume 完成集 → 直接 task.skipped(来源 resume)）；终局 mission.completed/failed/cancelled + store.finalize；M9 gate emitEvent 与 M10 budget 事件（warning=压缩发生/exceeded=Reject——在 agents executor 装配路径发射）汇入 sink；shouldStop = cancel 标记存在性检查）+ runner.test 增落盘/事件序/resume 裁剪用例
- [x] T008 [US1] workspace/validation 终局写接缝：workspace executor 处置路径回调（config 增可选 `onDisposal?: (entry: {taskId, diff?: string, review?: unknown}) => void`——merge 前取 getDiff、gate packages 关联）；validation gate 不改——runner 从 report.reviews/workspaces 聚合写 validation.json + diff.patch（门通过任务 diff）+ 集成测试（tmp 仓库 fleet run 落盘八件套数值一致——SC-001）
- [x] T009 [US1] 加速器三类事件发射点 `packages/repository/src`：codegraph 回退分支 / wiki stale 检测 / evidence 冲突路径增可选 emitEvent 注入（缺省丢弃，不改默认行为）+ 对应单测（触发路径各断言一次）

**Checkpoint**: 落盘与事件全集成立（kill -9 前 started 已落盘）

---

## Phase 4: User Story 2 - 观测 CLI (Priority: P2)

**Goal**: 六命令 + 孤儿报告（SC-004/006 数据面）

- [x] T010 [US2] CLI 命令注册与实现 `apps/cli/src/commands/`：ps（listRuns 表格 + `--orphans` 附扫描）/ status（viewRun + summary）/ logs（readEvents 时间线 + `--type` 前缀过滤）/ inspect（summary.json + 最新 report 面输出）/ diff（diff.patch cat；无则退出 2）/ cancel（写 cancel-requested 标记；已终态幂等提示——按 viewRun 终态判断）；apps/cli/src/index.ts 注册
- [x] T011 [US2] `packages/observability/src/orphan.ts`：scanOrphans（worktrees = M8 inventory() 复用；processes = `ps -eo pid,command` 过滤命令行含 FLEET_CHILD=1）+ cleanupOrphans（dry-run 默认 / force：进程 SIGTERM + worktree cleanupOrphan 复用）+ `fleet clean [--force]` 命令 + 单测（worktree 孤儿识别与清理归零；进程扫描按标记过滤——spawn 一个标记 sleep 替身）

**Checkpoint**: 六命令矩阵可断言

---

## Phase 5: User Story 3 - 崩溃恢复与 Resume (Priority: P3)

**Goal**: kill -9 → interrupted → resume 零重跑 → completed（SC-003/007）

- [x] T012 [US3] `packages/observability/src/resume.ts`：planResume(missionPath, runDir, fs)——mission.json 指纹 vs 当次 mission 重算比对（不一致 → {ok:false, reason:'fingerprint drift'}）；完成集 = events 中 task.completed 的 taskId；pendingTasks = tasks 差集；无未完任务 → ok:false（无可续）+ 单测（正常 / 漂移拒绝 / 全完成）
- [x] T013 [US3] `fleet run --resume [runDir]`：apps/cli run.ts——--resume 无参 = 该 mission 最新 interrupted run 目录；planResume → 拒绝即报错（退出 1，零半跑）；通过 → runMissionFile({resume})（新 runShort 目录续写，summary 累计 attempts = 源 summary + 本次）；e2e `tests/cli/recovery.test.ts`：① 正常 run 落盘八件套 + 数值一致（SC-001）；② hang 任务后台 run + kill -9 → ps interrupted + status 分布 + events 行级合法（SC-002）；③ resume → 已完成任务零重跑（events 该任务 started 恰一次）+ mission completed + 累计 attempts（SC-003）；④ cancel hang run → cancelled + 未开始 skipped + 二次幂等（SC-004）；⑤ 指纹漂移拒绝（SC-007）；⑥ 孤儿 worktree 制造→ps --orphans→clean --force 归零（SC-006）；⑦ 六命令未知 mission 非零退出 + ps 空态零退出
- [x] T014 [US3] 事件全集覆盖断言：recovery e2e ① 的 run 断言 events 含 mission.created/started/completed、task.queued/started/completed、workspace.created/destroyed、validation.started/completed、review.approved、budget.*（加速器三类在 repository 单测覆盖——T009）——SC-005

**Checkpoint**: M11 验收锚点 e2e 全绿

---

## Phase 6: Polish

- [x] T015 [P] 全量回归（lint/format/build/test 零失败）；README 仓库结构 + M11 规格链接 + 六命令文档；quickstart 走查；提交 milestone commit

---

## Dependencies & Execution Order

- Phase 1 → Phase 2（T002/T003 可并行）→ US1（T006/T007 先行，T008/T009 可并行）→ US2（T010/T011 并行）→ US3（T012 → T013 → T014）→ Polish
- T004/T005 为 scheduler/agents 扩展——T013 cancel e2e 依赖

## Implementation Strategy

- MVP = US1（落盘 + 事件）→ US2（可见）→ US3（可恢复）
- M8-M10 全量回归是每步的隐性门槛（runner.ts 深改）

## Notes

- runner.ts 是最深接缝——T007 动刀前先跑全量基线；所有扩展可选项缺省关闭（库层零回归）
- kill -9 e2e 用 node 后台进程 + process.kill(pid, SIGKILL)（macOS 本地）
