# Feature Specification: M6 RuntimeAdapter + Fake Agents（运行时契约与 Fake 执行端到端）

**Feature Branch**: `007-m6-runtime-fake-agents`

**Created**: 2026-09-11

**Status**: Draft

**Input**: User description: 对应 `agent-fleet-roadmap.md` Phase B / M6：
定义 RuntimeAdapter 契约（execute + cancel），实现 FakeRuntimeAdapter
（模拟五角色延迟/成功/失败），桥接到 M5 调度器，交付
`fleet run ./missions/demo.yaml` 端到端——Mission → DAG → Fake
五角色 → Complete。完成后 **Fleet Kernel release gate 达成**。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - fleet run 端到端 (Priority: P1)

作为 Fleet 开发者，我运行 `fleet run missions/demo.yaml`：mission
先经 M4 校验（非法文件拒绝并报全错误），然后构建 DAG、按 M5
调度循环派发到 Fake 运行时（模拟 reflex / focus / reason /
insight / wisdom 五角色的延迟与执行），全部完成后输出 Run
报告——每任务终态、执行次数、派发序、耗时；失败任务的重试与
传播语义与 M5 一致。**demo.yaml 跑到 Complete 即本故事验收。**

**Why this priority**: 这是 roadmap M6 的验收锚点（"Mission →
DAG → Fake 五角色 → Complete"）——Fleet Kernel 三层（实体/
调度/运行时）第一次整体通电。

**Independent Test**: 本仓库 `fleet run missions/demo.yaml` →
退出码 0，报告 status=completed、2 任务按依赖序执行；换一个
含必败任务的 mission → 退出码 1，重试与 skipped 传播可见。

**Acceptance Scenarios**:

1. **Given** 合法 execution mission（demo.yaml），**When**
   `fleet run <path>`，**Then** 退出码 0，报告：status=completed、
   每任务 completed、派发序符合依赖、耗时合理（Fake 延迟量级）。
2. **Given** 非法 mission 文件，**When** `fleet run`，**Then**
   运行前拒绝（M4 校验错误逐条输出），退出码 1，不产生任何
   执行。
3. **Given** 含必败任务的 mission（重试后仍败），**When**
   `fleet run`，**Then** 退出码 1，报告 status=failed、该任务
   attempts=2、传递依赖 skipped、传播链完整（M5 语义在端到端
   下不变）。
4. **Given** autonomous mission（无 tasks），**When** `fleet
   run`，**Then** 明确提示"任务规划属 Reason（M7）"，本次无
   任务可执行，不算失败（退出码 0 + 说明）。
5. **Given** `--json`，**When** 运行，**Then** 结构化 Run 报告
   （含 Run/TaskRun 实例——M4 schema 首次落地），文本模式人类
   可读。

---

### User Story 2 - Runtime 契约与 Fake 行为矩阵 (Priority: P2)

作为 M7+ 真实运行时（Codex / Gemini / Pi Adapter）的开发者，
我依赖一个稳定的 RuntimeAdapter 契约：`execute(request) →
result` + `cancel(runId)`；请求含 runId / agentId / cwd /
prompt / env / timeoutMs。FakeRuntimeAdapter 是契约的参考实现
与测试底座：**按角色模拟延迟**（reflex 快、wisdom 慢等画像）、
脚本化成败与异常；**timeout 诚实生效**（超过 timeoutMs 的执行
以 timeout 失败返回且不再产生后续效应）；**cancel 即时中止**
（在途执行以 cancelled 返回）；**进程清理完备**（timeout /
cancel / 完成后无残留计时器与悬挂 promise——进程可干净退出）。

**Why this priority**: 宪法 IV 的落点——FakeRuntimeAdapter MUST
先于任何真实 Adapter 存在，CI 端到端以 Fake 为准保持确定性；
timeout / cancel / cleanup 是真实运行时最难的部分，契约先在
Fake 上钉死语义。

**Independent Test**: 行为矩阵（roadmap 必测六项）：timeout /
cancel / failure / retry / concurrency / process cleanup——
全部在 Fake 上脚本化注入断言。

**Acceptance Scenarios**:

1. **Given** 脚本延迟 > timeoutMs 的任务，**When** execute，
   **Then** 在 timeoutMs 量级返回失败（code=timeout），且该
   "进程"不再产生任何后续结果（不会迟到成功）。
2. **Given** 在途执行，**When** cancel(runId)，**Then** 该执行
   以 cancelled 结果 settle（毫秒级，不等延迟走完），其他执行
   不受影响。
3. **Given** 脚本化 failure / 异常，**When** execute，**Then**
   结构化失败（code + detail），异常不逃逸契约边界。
4. **Given** cancel / timeout / 完成三种路径，**When** 结束后
   检查 Fake 内部，**Then** 在途表清空、无悬挂计时器（进程
   退出干净——process cleanup）。
5. **Given** 五角色各自默认延迟画像，**When** 无脚本覆盖时
   执行，**Then** 延迟符合画像（reflex 最快…wisdom 最慢），
   且画像可整体关闭（零延迟模式供 CI 快跑）。

---

### User Story 3 - 桥接与 Run 记录 (Priority: P3)

作为 M11 可观测层的预备消费者，`fleet run` 产出的报告不只是
M5 的 RunOutcome——它实例化 M4 定义的 Run / TaskRun 实体
（run_ 前缀 id、missionId、状态机、startedAt/endedAt），事件
流（mission.run.started / completed / failed、task.completed）
经 core 事件结构走 stderr。TaskExecutor（M5 端口）到
RuntimeAdapter 的桥接有明确规则：runId 生成、agentId 派生
（任务角色）、prompt 构造（任务目标）、timeoutMs 预算——
桥接层是唯一知道"任务如何变成运行时请求"的地方。

**Why this priority**: Run/TaskRun 是 M11 持久化的数据形态，
现在落地方可避免后续返工；桥接规则集中一处是宪法 IV 解耦的
实现纪律。

**Independent Test**: `fleet run --json` 的报告通过 M4
runSchema/taskRunSchema 校验（schema.parse 断言）；stderr 含
mission.run.started 与 mission.run.completed 事件。

**Acceptance Scenarios**:

1. **Given** 任意完成的 run，**When** 检查 `--json` 报告，
   **Then** 含 runId（run_ 前缀）/ missionId / status /
   startedAt / endedAt / taskRuns[]，全部通过 M4 schema。
2. **Given** 运行过程，**When** 观察 stderr，**Then** 有
   mission.run.started（开始）与 mission.run.completed /
   failed（终态）事件，不污染 stdout 的 --json。
3. **Given** 调度器派发一个任务，**When** 桥接层构造请求，
   **Then** RuntimeRequest 含生成的 runId、按任务角色派生的
   agentId、任务 goal 构造的 prompt、配置的 timeoutMs 与
   cwd（请求字段齐全可断言——桥接规则可测试）。
4. **Given** mission 约束含 maxDurationMs，**When** 配置运行
   预算，**Then** 任务 timeoutMs 预算从 mission 约束推导
   （剩余预算均分或整段透传，规则确定且记录在报告）。

---

### Edge Cases

- mission 文件不存在 / 不可读 / 目录：运行前拒绝（M4 文件级
  错误语义），退出码 1。
- Fake 抛非预期异常（脚本 bug）：等价失败，不击穿 CLI。
- timeout 与 cancel 竞争（先 cancel 后 timeout 到点）：结果为
  cancelled（先到先得，不产生第二个 settle）。
- 空任务列表（autonomous）：US1 场景 4 语义。
- mission 约束非法值已被 M4 拦截；运行期不再重复校验。
- 事件顺序：run.started 必先于任意 task 事件，终态事件最后
  （消费者可依赖的顺序保证）。
- 同一 CLI 进程内多次 run：runId 唯一（不复用）。
- Ctrl-C / 进程中断：M6 不做优雅关闭（M11 Recovery 范围），
  Fake 清理保证单次 run 内无泄漏即可。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `fleet run <path> [--json]` MUST 端到端执行：
  M4 校验（失败即拒绝、不执行）→ M5 buildDag + Scheduler →
  Fake 运行时 → Run 报告；退出码 0（completed / autonomous
  无任务）/ 1（failed / 文件或校验错误）/ 2（用法错误）。
- **FR-002**: RuntimeAdapter 契约 MUST 为
  `execute(request) → Promise<RuntimeResult>` +
  `cancel(runId) → Promise<void>`；RuntimeRequest MUST 含
  runId / agentId / cwd / prompt / timeoutMs（env 可选）；
  RuntimeResult MUST 含 ok 与失败码（timeout / cancelled /
  error）+ detail。
- **FR-003**: FakeRuntimeAdapter MUST 按五角色默认延迟画像
  模拟执行；脚本化覆盖（延迟 / 成功 / 失败 / 异常 / 指定
  runId 行为）；画像可整体置零（CI 快跑）。
- **FR-004**: timeout MUST 诚实：超过 timeoutMs 的执行以
  code=timeout 失败 settle，**此后该执行不得再产生任何结果**
  （迟到成功必须丢弃）。
- **FR-005**: cancel(runId) MUST 即时中止在途执行并以
  cancelled settle；不影响其他在途执行；timeout 与 cancel
  竞争时先到先得、单次 settle。
- **FR-006**: process cleanup MUST 完备：完成 / 失败 /
  timeout / cancel 后 Fake 在途表清空、无悬挂计时器（node
  进程可即刻干净退出）。
- **FR-007**: 桥接层（TaskExecutor → RuntimeAdapter）MUST
  集中生成规则：runId（run_ 前缀唯一）、agentId（任务角色
  派生）、prompt（任务 goal）、timeoutMs（mission maxDurationMs
  推导，无约束用默认）、cwd（目标仓库根）。
- **FR-008**: Run 报告 MUST 实例化 M4 Run / TaskRun 实体并
  通过其 schema；含 M5 RunOutcome 全部信息（派发序 / 传播链 /
  attempts）。
- **FR-009**: 事件 MUST 经 core 结构走 stderr：
  mission.run.started / mission.run.completed /
  mission.run.failed；顺序保证 started 先、终态最后。
- **FR-010**: 本里程碑 MUST 仅交付 Fake 运行时——真实 Adapter
  （Codex / Gemini / Pi）属 M7；`fleet run` 的运行时选择面
  预留（配置项）但只注册 Fake。
- **FR-011**: roadmap 必测六项（timeout / cancel / failure /
  retry / concurrency / process cleanup）MUST 全部有自动化
  断言；e2e 以 Fake 为准（宪法 IV，确定性）。

### Key Entities

- **RuntimeRequest**: runId、agentId、cwd、prompt、env?、
  timeoutMs。
- **RuntimeResult**: ok、code?（timeout / cancelled / error）、
  detail?、output?（Fake 的模拟输出）。
- **RuntimeAdapter（契约）**: execute + cancel；实现方（Fake /
  未来的真实 Adapter）不得让异常逃逸 execute。
- **FakeRuntimeAdapter**: 角色延迟画像 + 脚本化覆盖 + 在途
  表（cleanup 可观测）。
- **BridgeConfig**: timeoutMs 预算规则（maxDurationMs 推导 /
  默认值）、cwd、prompt 模板。
- **RunReport**: M4 Run 实例 + M5 RunOutcome 合一（对外报告
  形态）。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `fleet run missions/demo.yaml` 退出码 0、
  status=completed、任务按依赖序完成（roadmap M6 验收锚点
  的操作化）。
- **SC-002**: 必测六项矩阵（timeout / cancel / failure /
  retry / concurrency / process cleanup）100% 自动化断言，
  0 例悬挂或迟到结果。
- **SC-003**: timeout 诚实性：延迟 > timeoutMs 的执行 100%
  以 timeout 失败且无迟到成功（时序 + 结果双重断言）。
- **SC-004**: cancel 即时性：在途执行 cancel 后毫秒级 settle
  为 cancelled（远小于剩余延迟），其他执行不受影响。
- **SC-005**: cleanup：任意结束路径后 Fake 在途表为空，
  node 进程在 run 后无悬挂计时器（进程退出延迟 < 1s 量级）。
- **SC-006**: Run 报告通过 M4 runSchema 校验 100%（含
  taskRuns 状态机合法）；事件三枚齐序正确。

## Assumptions

- 真实运行时（Codex / Gemini / Pi Adapter）全部属 M7；M6 的
  `fleet run` 固定 Fake（FR-010），运行时选择配置面仅预留。
- 角色延迟画像是产品语义（reflex 快 → wisdom 慢），具体毫秒
  数由 plan 定；CI / 测试用零延迟模式。
- prompt 构造 = 任务 goal（+ 任务 id）的确定性模板——真实
  的 Context Builder 属 M10，此处最小可执行。
- timeoutMs 默认值与 maxDurationMs 推导规则（均分 vs 透传）
  由 plan 决策并写入报告；不做动态预算调整（M10 范围）。
- Run 持久化到 `.fleet/runs/` 属 M11——M6 报告只输出
  （stdout / --json），不落盘。
- 权限强制（角色 → 只读/写入）属 M7/M8 Workspace：Fake 运行
  时模拟执行不做真实文件操作。
- e2e 全部走 Fake（宪法 IV：CI 确定性）；零新增第三方依赖。
