# Feature Specification: M11 Observability + Recovery（可观测与恢复）

**Feature Branch**: `012-m11-observability-recovery`

**Created**: 2026-09-12

**Status**: Draft

**Input**: User description: "继续" — 对应 `agent-fleet-roadmap.md`
Phase D / M11：事件全集、Run 持久化（`.fleet/runs/<mission-id>/`）、
观测 CLI（status / logs / inspect / diff / ps / cancel）、崩溃恢复
（Crash Recovery / Run Resume / 孤儿进程与 Worktree 清理 / 部分
Mission 恢复）。roadmap M11 验收锚点：**进程异常退出后不丢失
Run 状态，能识别已完成任务、清理孤儿资源并从合理位置 Resume**。
宪法要求：结构化事件（mission / task / agent / validation /
budget / review / fallback）全程记录；Run 状态 MUST 可恢复。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run 持久化与事件全集 (Priority: P1)

作为 Fleet 运维者，每次 `fleet run` 把完整执行痕迹落盘到
`.fleet/runs/<mission-id>/`：mission 快照、事件流（JSONL 追加，
含 roadmap 事件全集——mission 创建/开始/完成/失败、task
排队/开始/完成/失败、agent 开始/完成/失败、workspace
创建/销毁、validation 开始/完成/失败、review 请求/批准/退回/
超限、budget 警告/超限、以及加速器侧 codegraph.fallback /
wiki.stale / evidence.conflict）、用量（usage.json）、变更面
（diff.patch）、验证证据（validation.json）与终局摘要
（summary.json）。落盘是**流式的**（事件即时追加，不攒批）——
进程任何时刻死亡，已发生的事件已在盘上。

**Why this priority**: 持久化是观测与恢复的共同地基；"Crash
后可恢复"的前提是"Crash 前已落盘"——验收锚点的第一半。

**Independent Test**: 正常 run 一个双任务 mission → 目录结构
齐全、events.jsonl 可逐行反序列化、事件序与执行序一致
（mission.started 先于 task.* 先于 mission 终态）；run 中途
kill -9 → 已发生的事件已落盘（尾部无半行）。

**Acceptance Scenarios**:

1. **Given** 一次完成的 run，**When** 查看 `.fleet/runs/<id>/`，
   **Then** mission.json / events.jsonl / usage.json / summary.json
   存在且内容与 RunReport 一致；有写授权任务时 diff.patch 与
   validation.json 亦存在。
2. **Given** run 过程中的任一事件，**When** 发生，**Then** 即时
   追加进 events.jsonl（每行一条合法事件，反序列化通过）。
3. **Given** 事件全集，**When** 对照 roadmap 目录，**Then** 各
   生命周期事件在对应时机发射（mission.created/started/
   completed/failed、task.queued/started/completed/failed、
   workspace.created/destroyed、validation.started/completed、
   review.requested/approved/changes_requested/exceeded、
   budget.warning/exceeded）；加速器事件（codegraph.fallback /
   wiki.stale / evidence.conflict）在既有调查路径触发时发射。
4. **Given** 同一 mission 多次 run，**When** 查看，**Then** 各
   run 目录互不覆盖（runId 区分），ps 可列出全部。
5. **Given** 进程被 kill -9，**When** 事后读 events.jsonl，
   **Then** 文件无损坏（每行完整可解析，尾部无半行截断）。

---

### User Story 2 - 观测 CLI (Priority: P2)

作为 Fleet 使用者，六个观测命令随时可用：`fleet ps`（列出全部
run 与状态——含活跃 / 已完成 / 已失败 / **中断（interrupted）**）；
`fleet status <mission>`（任务级状态表 + 终局摘要）；
`fleet logs <mission>`（事件流时间线，可过滤）；`fleet inspect
<mission>`（完整 RunReport JSON）；`fleet diff <mission>`（变更面
patch）；`fleet cancel <mission>`（对活跃 run 发出取消——运行中
任务的运行时收到取消，未开始任务不再开始，run 以 cancelled
终态收束并落盘）。全部命令只读 `.fleet/runs/`（cancel 除外）。

**Why this priority**: 落盘数据只有可见才有价值；六个命令是
roadmap 明文清单，也是 M12 Control Center 的数据面。

**Independent Test**: run 完成后逐命令断言输出；对活跃 run
（替身 hang）执行 cancel → cancelled 终态 + 未开始任务不执行 +
落盘完整。

**Acceptance Scenarios**:

1. **Given** 多个 run（完成 / 失败 / 中断），**When** `fleet ps`，
   **Then** 全部列出：mission id、run 状态、任务进度、时间。
2. **Given** 完成的 mission，**When** `fleet status`，**Then**
   任务表（每任务状态 / 尝试次数 / 耗时）+ 摘要（含 M9 验证门
   与 M10 预算摘要）。
3. **Given** 任一 mission，**When** `fleet logs`，**Then** 事件
   时间线（可 `--type task.` 前缀过滤），逐行可读。
4. **Given** 含写授权任务的 mission，**When** `fleet diff`，
   **Then** 输出 diff.patch 内容（变更面可审）。
5. **Given** 活跃 run（替身挂起），**When** `fleet cancel`，
   **Then** 在行任务的运行时被取消（fail-closed：取消即停），
   未开始任务标记 skipped，run 终态 cancelled，事件与摘要落盘。
6. **Given** 不存在的 mission，**When** 任一命令，**Then** 明确
   报错（非零退出码），不崩溃。

---

### User Story 3 - 崩溃恢复与 Resume (Priority: P3)

作为 Fleet 运维者，进程异常退出后：`fleet ps` 能把无终态的 run
识别为**中断**；`fleet status` 能指出已完成 / 进行中（中断点）/
未开始的任务分布；孤儿资源可清理——孤儿 worktree（M8 清单的
CLI 入口）与孤儿进程（Fleet 派生的仍存活子进程）；**Resume**
从合理位置续跑：已完成任务的成果保留（不重跑、已 merge 的变更
不再重复），未开始 / 进行中的任务重新执行，mission 以完整语义
收束。部分 Mission 恢复 = mission 文件仍可用时，从盘上 Run 状态
重建调度输入。

**Why this priority**: roadmap M11 验收锚点全文——Crash 后可恢复
并 Resume；长任务的工程可用性分水岭。

**Independent Test**: 双任务 mission（A 完成后 kill -9 于 B 进行
中——替身 hang + 外部 kill）→ ps 显示 interrupted → status 显示
A completed / B interrupted → resume（`fleet run --resume`）→ B
重跑、A 不重跑（执行计数断言）→ mission completed；孤儿 worktree
制造 → 清理命令归零。

**Acceptance Scenarios**:

1. **Given** 无终态（started 无 completed/failed/cancelled）的
   run 痕迹，**When** `fleet ps` / `fleet status`，**Then** 状态
   = interrupted，任务分布（completed / interrupted / pending）
   从事件流重建可查。
2. **Given** interrupted run，**When** `fleet run --resume`，
   **Then** 事件流中已 completed 的任务不再执行（调度输入按
   完成集裁剪），未完成任务照常执行，新事件追加进同一 mission
   的 run 目录（续跑痕迹连贯）。
3. **Given** crash 时可能残留的孤儿 worktree / 子进程，**When**
   清理入口执行，**Then** 与活动 run 无关的孤儿被列出并可清理
   （确认语义），活动资源不受影响。
4. **Given** crash 发生在任务执行中，**When** resume，**Then**
   该任务从中断点整体重跑（任务级原子性——无"半个任务"续传）。
5. **Given** resume 时 mission 文件已变更，**When** resume，
   **Then** 校验 mission 指纹（id + 任务集 hash）——不一致则
   拒绝并提示新跑（防止拿旧进度跑新任务集）。
6. **Given** 多次 crash-resume 循环，**When** 最终完成，**Then**
   summary.json 反映最终一次 run 的终局 + 累计执行统计（跨
   resume 的执行次数可追溯）。

---

### Edge Cases

- events.jsonl 尾部半行（极端时刻写入）：读取容错——跳过尾行
  半行并标注（不崩溃、不静默吞掉行数差异）。
- run 目录已存在同名（同 mission 重复 run）：runId 子目录 /
  文件名隔离，互不覆盖。
- cancel 与正常完成竞争：先到者生效，后到者幂等（cancel 已
  终态的 run = 无操作提示）。
- ps 空目录（无任何 run）：友好空态，零退出码。
- resume 时原 runtime 配置不可得：resume 使用当次 CLI 参数
  （不试图还原 crash 前的运行时选择——文档明确）。
- diff.patch 对 merge 后的 run：记录门通过时的最终变更面
  （merged 内容）；失败任务记录其 worktree 销毁前最后一次
  diff（若可得）。
- usage.json 与 M10 ledger 的关系：同一事实的两种视图（文件 =
  终局快照，ledger = 内存聚合），数值必须一致。
- 孤儿进程清理的安全边界：只清理 Fleet 明确派生（可追溯命令
  行标记）的进程——不误杀同名无辜进程。
- .fleet/runs/ 不进主仓 git（沿用 `.fleet/` 忽略语义）。
- 中断检测的误报窗：进程刚启动、事件尚未写 started 的瞬间
  crash → 无 started 记录 → 该 run 不出现于 ps（等价于从未
  开始——语义正确，不虚假造 interrupted）。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `fleet run` MUST 流式持久化：run 开始即建
  `.fleet/runs/<mission-id>/`（mission.json = mission 快照 +
  指纹）；事件即时追加 events.jsonl（每行一条，反序列化合法）；
  终局写 summary.json（终态 + 任务表 + 验证门 / 预算摘要）。
- **FR-002**: 写授权任务 MUST 追加落盘 diff.patch（门通过时的
  最终变更面）与 validation.json（ReviewPackage 序列化）；用量
  终局快照 usage.json 与 RunReport.budget 数值一致。
- **FR-003**: 事件全集 MUST 覆盖 roadmap 目录：mission.created/
  started/completed/failed/cancelled、task.queued/started/
  completed/failed/skipped、workspace.created/destroyed、
  validation.started/completed、review.requested/approved/
  changes_requested/exceeded、budget.warning/exceeded、
  codegraph.fallback / wiki.stale / evidence.conflict（后三类在
  既有调查路径接入发射点）。
- **FR-004**: `fleet ps` MUST 列出全部 run（mission id、状态、
  任务进度、时间），状态含 interrupted（事件流无终态的 run）。
- **FR-005**: `fleet status <mission>` MUST 从落盘数据重建任务级
  状态表（completed / failed / skipped / interrupted / pending
  分布）+ 终局摘要；`fleet logs` MUST 输出事件时间线（类型前缀
  过滤）；`fleet inspect` MUST 输出完整 RunReport JSON；`fleet
  diff` MUST 输出 diff.patch；命令对未知 mission 非零退出。
- **FR-006**: `fleet cancel <mission>` MUST 对活跃 run 生效：在
  行任务取消（运行时 cancel 通道）、未开始任务不开始、终态
  cancelled 落盘；对已终态 run 幂等提示。
- **FR-007**: resume MUST 基于 events.jsonl 重建完成集：已完成
  任务不再执行、未完任务重跑（任务级原子）、事件续写同一
  mission 目录；mission 指纹（id + 任务集）不一致 MUST 拒绝。
- **FR-008**: 孤儿清理 MUST 提供 CLI 入口：孤儿 worktree（M8
  inventory）列出 + 确认清理；孤儿进程按 Fleet 派生标记识别
  （不误杀）、列出 + 确认清理。
- **FR-009**: 半行容错 MUST 成立：events.jsonl 尾部损坏行跳过
  并标注，读取零崩溃。
- **FR-010**: `.fleet/runs/` MUST 不污染主仓（忽略语义沿用）。
- **FR-011**: 全部断言以既有替身矩阵驱动（Fake / 替身 CLI /
  hang 替身 + kill 模拟 crash）；e2e 在 tmp git 仓库执行。

### Key Entities

- **RunStore**: run 目录生命周期（mission.json / events.jsonl /
  summary.json / usage.json / diff.patch / validation.json）。
- **EventSink**: 流式追加器（即时 flush；FleetEvent 序列化）。
- **RunStatusView**: 从事件流重建的状态视图（ps / status 数据
  面）：run 终态 + 任务分布 + 时间。
- **ResumePlan**: 完成集（skip）+ 待执行集 + 指纹校验结果。
- **OrphanReport**: 孤儿 worktree 清单（M8 inventory）+ 孤儿进程
  清单（派生标记识别）+ 清理确认入口。
- **MissionFingerprint**: mission id + 任务集（id/角色/依赖）哈希
  ——resume 一致性校验。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 完整 run 落盘结构 100% 齐全且与 RunReport 数值一致
  （summary/usage/diff/validation 四面）。
- **SC-002**: kill -9 中断后：events.jsonl 无损坏（行级合法率
  100%）；ps 识别 interrupted；status 任务分布正确（completed/
  interrupted/pending 各就各位）——验收锚点前半操作化。
- **SC-003**: resume：已完成任务 0 重跑（执行计数断言）、未完
  任务重跑、终局 summary 反映跨 resume 累计——验收锚点后半
  操作化。
- **SC-004**: 六命令矩阵（ps/status/logs/inspect/diff/cancel）
  输出与落盘一致；cancel 对 hang 活跃 run 生效（cancelled 终态
  + 未开始任务零执行）。
- **SC-005**: 事件全集覆盖率：一次含验证门的 run 中，roadmap
  列举的各事件类型至少各出现一次（加速器三类以调查路径注入
  断言）。
- **SC-006**: 孤儿清理：制造孤儿 worktree / 进程 → 列出准确
  （活动资源零误报）→ 清理后归零。
- **SC-007**: 指纹防漂移：mission 任务集变更后 resume 被拒绝
  （结构化报错，零半跑状态）。

## Assumptions

- 落位 `packages/observability`（RunStore / EventSink / 视图重建
  / ResumePlan / 孤儿报告）+ CLI 六命令（apps/cli）——roadmap
  终局结构。
- cancel 的进程间通道：Fleet 单机单进程模型——cancel 命令写
  `.fleet/runs/<id>/cancel-requested` 标记文件，run 内轮询标记
  （调度批次屏障间检查）→ 取消在行任务的运行时 adapter.cancel
  ——跨进程信号（SIGINT 等）不引入（M12 Control Center 可换
  通道，语义不变）。
- 孤儿进程识别：Fleet 派生子进程统一带 `FLEET_CHILD=1` env
  标记；清理扫描按标记过滤（ps 输出解析，macOS 本地）。
- resume 不还原 crash 前运行时选择（用当次 CLI 参数）；执行
  历史跨 resume 累计在 summary（累计 attempts）。
- 事件发射点接入：任务/工作区/验证/审阅事件接 executor/gate
  既有 emitEvent 通道统一落盘；budget.warning/exceeded 在 M10
  压缩/拒绝路径发射；加速器三类事件接 repository 包既有降级
  路径（补发射点，不改行为）。
- `.fleet/runs/` 结构按 roadmap 原文（artifacts/ logs/ 目录本期
  可为空占位——artifacts 落盘形态随 M12 Review Package 对外暴露
  再定）。
- 零新增第三方依赖；e2e kill 模拟用 SIGKILL（macOS 本地）。
