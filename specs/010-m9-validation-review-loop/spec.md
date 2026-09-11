# Feature Specification: M9 Validation + Review Loop（独立验收与审阅循环）

**Feature Branch**: `010-m9-validation-review-loop`

**Created**: 2026-09-11

**Status**: Draft

**Input**: User description: "继续" — 对应 `agent-fleet-roadmap.md`
Phase C / M9：实现 Fleet 独立 Validation Runner（Git Diff / Lint /
Typecheck / Tests）与 Wisdom 审阅循环（上限 maxReviewLoops = 2）。
宪法 III（Independent Validation，NON-NEGOTIABLE）的核心落点：
**Reason / Reflex 自报"测试通过"不算验收证据，只有 Validation
Runner 的结果可以作为 Mission 验收证据**（roadmap M9 验收锚点）。
M8 的隔离 worktree 与显式 merge 至此获得验证门：变更在合入主分支
之前，必须先通过独立验证与审阅。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Validation Runner 独立验收 (Priority: P1)

作为 Mission 的验收方，写授权任务（reason / reflex）的实现在其
隔离 worktree 中完成后，Fleet 的 Validation Runner 在该 worktree
上**独立执行**四类检查：Git Diff（变更面）、Lint、Typecheck、
Tests；产出结构化的 Validation Artifact——每类检查的命令、结果
（pass / fail / skipped / timeout）、输出摘要、时长与证据类型，
以及整体结论。Runner 与实现者物理无关（不在实现者进程内、不读
实现者会话），实现者的自报结果（如输出里写着"tests passed"）
**不出现在验收判定路径中**。

**Why this priority**: 这是宪法 III 的直接落点与 roadmap M9
验收锚点——没有独立 Validation Runner，"测试通过"只是实现者的
自我声明；有了它，Mission 验收第一次有了系统级证据源。

**Independent Test**: tmp git 仓库 + 替身运行时写变更（含故意
注入 lint / test 失败的变更）：Runner 执行四类检查，产出
Artifact；实现者输出中注入"tests passed"自报、同时让真实检查
失败——验收判定只看 Artifact（失败），自报被忽略。

**Acceptance Scenarios**:

1. **Given** 一个写授权任务在 worktree 中完成（有变更），**When**
   Validation Runner 执行，**Then** 在该 worktree 上依次执行
   diff / lint / typecheck / tests 四类检查，产出
   ValidationArtifact（关联 taskId / runId / workspace、
   loop 序号），每项检查结构化可断言。
2. **Given** 任一必选检查失败（非零退出 / 断言失败），**When**
   检查完成，**Then** Artifact 整体结论 = fail，失败检查的
   输出摘要可见（截断上限，不吞关键信息）。
3. **Given** 某类检查命令在当前仓库不可用（如无 lint 脚本），
   **When** Runner 执行，**Then** 该检查记 skipped（结构化，
   不算失败、不静默消失），其余检查照常。
4. **Given** 某检查超过超时上限，**When** 超时发生，**Then**
   该检查记 timeout = 失败（结构化，含已运行时长），Runner
   不悬挂。
5. **Given** 实现者（替身）输出含"tests passed"自报而真实
   检查失败，**When** 验收判定发生，**Then** 判定 100% 依据
   ValidationArtifact（fail），自报零影响——验收锚点操作化。
6. **Given** 任务无任何变更（空 diff），**When** Runner 执行，
   **Then** 产出 noop Artifact（无变更可验证，不算失败），
   进入后续审阅（由 Wisdom 裁决"没干活"是否可接受——不自动
   放行）。

---

### User Story 2 - Wisdom 审阅循环（上限 2 轮） (Priority: P2)

作为 Mission 的验收方，Validation 通过后，Wisdom（只读审阅
角色）基于 Mission + Validation Artifact + 任务 diff（+ 前轮
审阅意见）执行内部审阅，产出结构化裁决：**Approved** 或
**Changes Requested**（附具体审阅意见）。Changes Requested →
Reason 在**同一 worktree** 上修复（审阅意见作为修复上下文）→
重新 Validation → 重新 Wisdom 审阅——循环有**固定上限
maxReviewLoops（默认 2）**；超限后任务以 review_exceeded 终态
收束（完整审阅历史结构化保留），**不强合、不无限循环**（宪法
III / V：禁止无限重试与无限 Review）。

**Why this priority**: Validation 回答"客观检查过没过"，Wisdom
回答"这个变更该不该合"——两者合起来才是完整验收门；固定上限
是确定性内核的硬约束（宪法 V）。

**Independent Test**: 替身运行时脚本化裁决（第一轮
changes_requested → 修复 → 第二轮 approved）：循环路径全绿；
另一脚本连续 changes_requested：第 2 轮后 review_exceeded、
不再发起第 3 轮。

**Acceptance Scenarios**:

1. **Given** Validation 整体 pass，**When** Wisdom 审阅执行，
   **Then** 产出结构化 ReviewVerdict（approved /
   changes_requested + 意见），Wisdom 的输入含 Mission、
   ValidationArtifact、任务 diff。
2. **Given** Validation 整体 fail，**When** 循环推进，**Then**
   进入"修复 → 重新验证"路径，与 changes_requested 同路径，
   统一由 maxReviewLoops 收束（M9 默认：fail 不直接终止，
   给修复机会）。
3. **Given** 首轮 Changes Requested，**When** Reason 修复后
   重新验证通过、Wisdom 改判 Approved，**Then** 任务验收成功
   （循环 1 轮，未超限）。
4. **Given** 连续 2 轮循环（修复后仍 Changes Requested 或
   Validation 仍 fail），**When** 第 2 轮审阅结束仍不通过，
   **Then** 任务终态 = review_exceeded，完整历史（每轮
   Artifact + Verdict）入报告，**不再发起第 3 轮**。
5. **Given** Wisdom 运行时执行失败（超时 / 错误 / 输出不可
   解析），**When** 审阅步骤出错，**Then** fail-closed：任务
   按失败收束（不因审阅者缺席而放行），错误结构化入报告。
6. **Given** 修复轮次发生，**When** 重新验证，**Then** diff
   语义 = 相对基线的完整 diff（含修复，非增量），Artifact
   的 loop 序号 +1 可追溯。

---

### User Story 3 - fleet run 验证门与事件记录 (Priority: P3)

作为 `fleet run` 的使用者，M8 的"成功即合"默认处置在 M9 升级
为**验证门**：写授权任务的 merge 只在 Validation 通过 **且**
Wisdom Approved 后发生；Validation 失败、审阅不通过或循环超限
→ 按失败处置（默认 destroy，keep-on-finish 可选——保留现场供
人工检查）。验证与审阅的每一步都以结构化事件记录（宪法：
mission / task / agent / validation / budget / review /
fallback 事件全程可记录）；任务终态附 Review Package（实现
diff + 各轮 Validation Artifact + 审阅历史 + 最终裁决的结构化
汇总）——这是 M12 对外暴露的前身。

**Why this priority**: 验证门把 US1/US2 的能力接入真实执行流，
使 fleet run 的"任务成功"语义从"执行器没报错"升级为"独立验证
通过 + 审阅批准"；事件与 Review Package 让验收过程可审计、
可回放。

**Independent Test**: tmp git 仓库双任务 mission（一任务脚本化
通过全流程、一任务脚本化超限）：通过者 merge 进主分支、超限者
零 merge 且 worktree 按策略处置；事件流完整覆盖两任务全部
validation / review 步骤。

**Acceptance Scenarios**:

1. **Given** 写授权任务通过验证 + 审阅，**When** run 结束，
   **Then** 其变更按 M8 merge 语义合入主分支（merged +
   提交号），处置记录含验证门结论。
2. **Given** 任务 validation fail / 审阅未通过 / 循环超限，
   **When** 处置发生，**Then** **零 merge**（主分支不含其
   变更），worktree 默认 destroy、可选保留（keep-on-finish）。
3. **Given** 只读角色任务，**When** run 推进，**Then** 不触发
   验证门（无写权限即无变更可验证——直通，语义与 M8 一致）。
4. **Given** 验证与审阅全程，**When** 每步发生，**Then**
   结构化事件写入（含 loop 序号、结论、关联 id），事件可
   序列化且重放可还原完整循环历史。
5. **Given** 任务到达终态（通过 / 超限 / 失败），**When**
   报告生成，**Then** Review Package 汇总 diff + 全部
   Artifact + 审阅历史 + 最终裁决，随 RunReport 可查。
6. **Given** 验证门启用（M9 后默认），**When** 与 M8 的
   auto 策略对照，**Then** 语义向后兼容为"auto + 门"：执行
   成功不再直接 merge，而是走门后 merge；门整体可关闭，
   关闭时行为回退 M8 auto（显式逃生口，供对照测试与渐进
   采信）。

---

### Edge Cases

- 空 diff 任务：noop Artifact + Wisdom 照常裁决（不自动通过
  ——"没干活"由审阅者定性）。
- 修复轮次什么都没改（diff 与上轮相同）：Validation 照常、
  Wisdom 可再次 changes_requested（同样的输入同样的意见），
  循环靠上限收束，不特殊处理。
- 检查命令把 worktree 弄脏（生成临时文件）：Runner 在检查后
  不清理工作树（diff 检查先行记录变更面，脏文件属实现者责任
  范畴）；Runner 自身除检查命令外零写入。
- 检查命令本身崩溃（SIGKILL / 非正常退出）：按该检查 fail
  记录（exitCode + 输出），Runner 不崩溃。
- maxReviewLoops 配置为 0：跳过审阅（Validation 通过即验收）
  ——语义合法（纯验证门模式），默认仍为 2。
- Wisdom 裁决输出不可解析（真实运行时返回非结构化内容）：
  解析失败 = 审阅错误，fail-closed 处理。
- reflex（轻写）任务：同样走验证门（写授权不豁免——宪法 III
  不区分实现者角色）。
- 同一 run 内多个写任务：各自独立验证与审阅循环，互不阻塞
  （验证在各自 worktree 内执行，天然隔离）。
- Validation Artifact 的输出摘要上限（防单事件过大）：截断
  保留头尾（错误通常在尾部），标注截断长度。
- Review Package 中 diff 过大：引用 workspace 的 diff 产物而
  非内联全文（引用 + 摘要统计：文件数 / 增删行数）。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: ValidationRunner MUST 提供独立验证能力：给定任务
  的 workspace（或目标目录）与 ValidationProfile，执行 Git
  Diff / Lint / Typecheck / Tests 四类检查，返回结构化
  ValidationArtifact；Runner MUST NOT 在实现者进程内执行、
  MUST NOT 读取实现者会话或自报输出。
- **FR-002**: ValidationArtifact MUST 含：关联（taskId / runId /
  workspace、loop 序号）、每类检查的明细（kind / command /
  status ∈ pass|fail|skipped|timeout / exitCode / 输出摘要 /
  durationMs / 证据类型）、整体结论 ∈ pass|fail|noop；任一
  必选检查 fail → 整体 fail。
- **FR-003**: 验证 MUST 在任务的隔离 worktree 上执行（cwd =
  worktree），主仓零写入；检查命令产生的副作用不回退（记录
  而已）。
- **FR-004**: Mission 验收判定 MUST 且只能引用 Validation
  Artifact（+ Review Verdict）；实现者自报结果 MUST NOT 进入
  验收判定路径（验收锚点）。
- **FR-005**: 检查命令 MUST 通过 ValidationProfile 配置：默认
  自动探测仓库约定（脚本清单类约定），mission 级可覆盖（每类
  检查的命令 / 必选性 / 超时）；探测不到的检查记 skipped。
- **FR-006**: 每检查命令 MUST 有超时上限（默认值 + 可配置），
  超时 → 该检查 timeout（按 fail 计），Runner 不悬挂。
- **FR-007**: Wisdom 审阅 MUST 产出结构化 ReviewVerdict：
  verdict ∈ approved | changes_requested + 审阅意见；输入 =
  Mission + ValidationArtifact + 任务 diff（+ 前轮意见）；
  输出不可解析 → 审阅错误（fail-closed）。
- **FR-008**: Review Loop MUST 有固定上限 maxReviewLoops（默认
  2，mission 可配置，0 = 纯验证门）；超限 → 任务终态
  review_exceeded，完整历史结构化保留；MUST NOT 无限循环。
- **FR-009**: 修复轮次 MUST 在同一 workspace 重新执行实现
  （修复上下文含上轮审阅意见 / 验证失败摘要）→ 重新验证 →
  重新审阅；DAG 结构不变（显式任务级循环，非 Dynamic
  Replanning——宪法 V）。
- **FR-010**: fleet run 集成 MUST 实现验证门：写授权任务
  merge 仅当 Validation pass 且 Wisdom approved；否则零
  merge、按 M8 失败处置（默认 destroy，可选保留）；门可
  整体关闭（回退 M8 auto 语义，逃生口）。
- **FR-011**: validation / review 全过程 MUST 记录结构化事件
  （validation 与 review 的 started/completed、loop 超限），
  事件含 loop 序号与结论，可序列化、可重放还原历史。
- **FR-012**: 任务终态 MUST 附 Review Package：实现 diff
  （引用 + 摘要）、各轮 ValidationArtifact、审阅历史、最终
  裁决的结构化汇总，随 RunReport 可查。
- **FR-013**: 集成断言 MUST 以 FakeRuntimeAdapter 驱动（脚本化
  写行为 + 脚本化 Wisdom 裁决），e2e 在 tmp git 仓库执行，
  不触碰本仓库工作区（宪法 IV：CI 以 Fake 为准）。

### Key Entities

- **ValidationCheck**: kind（diff / lint / typecheck / tests）、
  command、status（pass / fail / skipped / timeout）、exitCode、
  outputExcerpt、durationMs、evidence kind。
- **ValidationArtifact**: taskId、runId、workspaceRef、loop、
  checks[]、overall（pass / fail / noop）、createdAt。
- **ValidationProfile**: 各类检查的命令、必选性、超时；来源
  = 自动探测 + mission 覆盖。
- **ReviewVerdict**: verdict（approved / changes_requested）、
  comments、loop。
- **ReviewLoopState**: 当前 loop 序号、历史（Artifact + Verdict
  序列）、maxReviewLoops、终态（approved / review_exceeded /
  review_error）。
- **ReviewPackage**: 终态汇总（diff 引用、全部 Artifact、审阅
  历史、最终裁决、处置结果）。
- **ValidationGate**（run 集成语义）: 执行成功 → 验证 → 审阅 →
  （通过）merge /（不通过或超限）失败处置。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 自报 vs 独立验证矛盾场景（实现者自报"tests
  passed" + 真实检查失败）：验收判定 100% 取 Artifact 结论
  （fail），自报零影响——M9 验收锚点操作化，e2e 断言全绿。
- **SC-002**: 检查状态矩阵（pass / fail / skipped / timeout
  × 四类检查）全部结构化可断言：0 崩溃、0 悬挂、0 主仓写入。
- **SC-003**: 审阅循环三路径 e2e 全绿：一次通过（0 轮修复）、
  一轮修复后通过（1 轮）、连续不通过 → 第 2 轮后
  review_exceeded 且**无第 3 轮发起**（上限强制可断言）。
- **SC-004**: 验证门：未通过（validation fail / 审阅未过 /
  超限）任务 0 merge（主分支不含其变更，git 断言）；通过者
  merge 成功且处置记录含门结论。
- **SC-005**: 事件完整性：每个 validation / review 步骤 1 条
  完成事件（含 loop 与结论），序列化 round-trip 校验通过，
  重放可还原完整循环历史。
- **SC-006**: Review Package 在任务终态 100% 可得（通过 /
  超限 / 失败三态），内容含全部轮次 Artifact 与裁决。

## Assumptions

- 落位 `packages/validation`（roadmap 最终结构中的 validation
  包）；依赖 core（事件）+ mission（角色）+ workspace（diff /
  处置接缝）+ agents / runtime（Wisdom 执行）。
- 默认 ValidationProfile 的自动探测按脚本清单类约定（如
  package.json scripts：lint / typecheck / test）；探测逻辑面向
  "命令存在性"，不绑定具体包管理器。
- worktree 内依赖安装（如 node_modules）不在 M9 自动化范围：
  Profile 允许配置前置命令，e2e 用轻量替身命令（shell 脚本即
  检查命令）；本仓真实自举（fleet 验证 fleet）属使用侧配置
  演示，非验收必需。
- Validation fail 也消耗循环轮次（修复路径与 changes_requested
  统一，M9 默认）；maxReviewLoops 语义 = 修复轮次上限
  （首轮不计）。
- Wisdom 审阅质量取决于真实运行时；M9 验收全部用 Fake 注入
  裁决（宪法 IV：CI 确定性）；Insight 证据接入审阅上下文属
  M10 Context Builder，M9 的 Wisdom 输入限于 Mission /
  Artifact / diff。
- 检查命令失败即任务级信号：Runner 不重试检查命令（重试语义
  属任务级循环，固定 retry 语义沿用 M5）。
- 零新增第三方依赖；无新 CLI 命令（`fleet run` 报告增强 +
  库能力；独立 `fleet validate` CLI 留待有真实使用诉求再议）。
