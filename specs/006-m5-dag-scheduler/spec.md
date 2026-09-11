# Feature Specification: M5 Task DAG + Scheduler（任务图与确定性调度）

**Feature Branch**: `006-m5-dag-scheduler`

**Created**: 2026-09-11

**Status**: Draft

**Input**: User description: "开始下一个任务" — 对应
`agent-fleet-roadmap.md` Phase B / M5：从 mission 的 tasks 构建
DAG，提供依赖校验、环检测、就绪选择、失败传播与确定性
Rule-based 调度循环（无依赖任务真实并发）。执行器为注入端口，
真实 RuntimeAdapter 由 M6 提供。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 构建任务图与图校验 (Priority: P1)

作为 M6 Runtime / M7+ 的 Fleet 内部消费者，我把 mission 的
tasks 交给 DAG 模块，得到一个可查询的任务图：依赖关系被验证
（悬空 / 自环——对动态产生的任务同样成立）、**环被检测并精确定位**
（A→B→C→A 报出成环节点链，而非泛泛失败）；任意时刻我能问
"哪些任务就绪"（全部依赖已完成的 pending 任务），答案确定有序。

**Why this priority**: DAG 是调度器的数据结构地基；M4 刻意把图
语义留给本里程碑（多节点环检测 / 就绪选择），这里是它的落点。

**Independent Test**: 拓扑矩阵——linear（a→b→c）、parallel（三个
独立任务）、diamond（a→{b,c}→d）、cycle（a→b→c→a，拒绝并报
出环链）、missing（悬空依赖拒绝）、self（自环拒绝）——每种
拓扑的构建结果与错误定位可断言。

**Acceptance Scenarios**:

1. **Given** diamond 拓扑的 tasks，**When** 构建 DAG，**Then**
   成功，依赖边数正确，b 与 c 在 a 完成前不就绪、a 完成后同时
   就绪、d 在 b/c 全部完成前不就绪。
2. **Given** 含环的 tasks（a→b→c→a），**When** 构建 DAG，
   **Then** 拒绝并报出环链（节点顺序明确），不是无限循环或
   泛泛错误。
3. **Given** 悬空或自环依赖（含运行时动态产生的任务），**When**
   构建 / 增补，**Then** 拒绝并定位到具体任务的 dependsOn
   （复用 M4 语义规则的表达）。
4. **Given** 任意 DAG 状态，**When** 查询就绪任务，**Then**
   结果按稳定顺序（mission 声明序）返回，同状态同结果。

---

### User Story 2 - 确定性调度循环与真实并发 (Priority: P2)

作为 Fleet 开发者，我拿到一个调度器：喂给它 DAG 与一个执行器
端口（M5 用可控的测试假执行器；M6 的 RuntimeAdapter 将适配到
同一端口），它循环执行"就绪选择 → 并发检查（默认 maxConcurrency
= 3）→ 派发 → 收结果 → 更新图"，直到终态。**无依赖的任务真实
并发执行**（不是串行轮询假装并发）；并发数严格不超过上限；
调度决策全部是确定性规则（无 LLM、无动态重排，宪法 V）。

**Why this priority**: 这是 Fleet Kernel 的心脏——roadmap M5 验收
锚点"无依赖的任务能够真实并发"直接指向本故事。

**Independent Test**: 用带可控延迟的假执行器（如 3 个任务各延迟
100ms）：并发调度总耗时 ≈ 一批耗时（约 100ms 量级）而非串行
总和（300ms+）；同时把 ready 任务加到 5 个，断言任意时刻
running ≤ 3。

**Acceptance Scenarios**:

1. **Given** 3 个无依赖任务 + 延迟执行器（各 100ms），**When**
   调度至完成，**Then** 总耗时接近单任务量级（真实并发），
   全部 completed。
2. **Given** 5 个就绪任务与 maxConcurrency=3，**When** 调度，
   **Then** 任意时刻 running 任务 ≤ 3，前 3 完成后余 2 接续。
3. **Given** 相同 DAG + 相同执行器行为，**When** 重复调度，
   **Then** 派发顺序与结果完全一致（确定性，稳定顺序派发）。
4. **Given** maxConcurrency / retry 可显式覆盖（默认 3 / 1），
   **When** 配置 1，**Then** 行为退化为串行且语义不变。

---

### User Story 3 - 失败传播与终态语义 (Priority: P3)

作为 Fleet 开发者，任务失败时调度器按固定规则处理：失败任务
**重试一次**（retry=1），再失败则终态 failed；其**全部传递依赖
标记为 skipped**（不可运行、不误报失败）；当无任务可再推进时，
run 终态确定——全部 completed → completed；存在 failed →
failed（skipped 不算失败原因，只是后果）。全程状态可查询。

**Why this priority**: 失败是分布式执行的常态语义；固定重试与
显式传播让"部分失败"成为可推理的状态而非异常（宪法 V：固定
retry、显式传播，禁止无限重试）。

**Independent Test**: 拓扑 a→{b(必败),c}→d：a 完成、b 重试一次
后 failed、c 正常完成、d 被跳过；run 终态 failed；状态序列可
断言（b 恰好执行 2 次）。

**Acceptance Scenarios**:

1. **Given** 必败任务（重试后仍败），**When** 调度，**Then**
   该任务恰好执行 2 次（初次 + 1 次重试）后终态 failed。
2. **Given** failed 任务的存在，**When** 调度继续，**Then**
   其传递依赖全部标记 skipped（不执行、不重试），无依赖任务
   照常完成。
3. **Given** 全部任务 completed（无 failed），**When** 调度
   收敛，**Then** run 终态 completed。
4. **Given** 存在 failed（连带 skipped），**When** 调度收敛，
   **Then** run 终态 failed，且每个 skipped 任务可追溯到失败
   祖先（传播链可见）。
5. **Given** 重试后成功的任务（第一次失败、重试成功），**When**
   调度，**Then** 终态 completed，下游正常推进。

---

### Edge Cases

- 空任务列表（autonomous mission 未规划）：DAG 合法但空，
  调度立即收敛 completed（不算失败）。
- 单任务自环 / 双节点互环：构建即拒绝（US1 场景 3 / 矩阵）。
- 重复派发的竞态：同一任务不得同时 running 两份（调度器内部
  串行决策、并发只发生在执行器调用层）。
- 执行器抛异常 vs 返回失败：两者等价为任务失败（异常不击穿
  调度循环）。
- 执行器超时：M5 不实现超时（RuntimeAdapter 的 timeoutMs 是
  M6 契约），但执行器返回"超时失败"按普通失败处理。
- maxConcurrency=0 / 负数 / retry<0：配置校验拒绝。
- 全部任务都在等待一个永不完成的根（理论上下游全 skipped 由
  失败传播覆盖；纯 pending 死等不存在——环已拒绝，无环图必有
  就绪任务或已终态）。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: DAG 构建 MUST 从 mission tasks（或等价任务清单）
  生成任务图：节点含任务与状态（pending/ready/running/completed/
  failed/skipped，对齐 M4 TaskRunStatus），边来自 dependsOn；
  同一任务集构建结果确定。
- **FR-002**: 图校验 MUST 覆盖：悬空依赖、自环、**多节点环**
  （报出成环节点链）；对静态 mission 与运行时动态任务一致适用
  （复用/扩展 M4 语义规则）。
- **FR-003**: 就绪选择 MUST 返回"全部依赖 completed 且自身
  pending"的任务，按 mission 声明序稳定排序；同状态同结果。
- **FR-004**: 调度器 MUST 为确定性规则循环（无 LLM、无动态
  DAG 重排、无 Agent 协商——宪法 V）：就绪 → 并发检查 → 派发
  → 收结果 → 更新图，直至终态。
- **FR-005**: 派发 MUST 真实并发（异步并行调用执行器）且任意
  时刻 running 数 MUST ≤ maxConcurrency（默认 3，可覆盖，
  合法域 ≥ 1）。
- **FR-006**: 失败任务 MUST 重试固定次数（默认 retry=1，可
  覆盖，合法域 ≥ 0），重试仍败 → 终态 failed。
- **FR-007**: failed 任务的全部传递依赖 MUST 标记 skipped
  （不执行不重试）；skipped 不改变已完成任务的终态；run 终态 =
  存在 failed → failed；否则全部 completed → completed；
  空 DAG → completed。
- **FR-008**: 执行器 MUST 为注入端口（execute(task) → 成功/
  失败），执行器抛异常等价为失败，MUST NOT 击穿调度循环；
  M6 RuntimeAdapter 适配到该端口。
- **FR-009**: 调度全程状态 MUST 可查询（每任务状态与执行
  次数、run 终态、传播链）；同输入同执行器行为 → 同派发序列
  （可复现）。
- **FR-010**: 本里程碑 MUST NOT 引入 CLI 命令（`fleet run` 属
  M6）与任何持久化（Run 持久化属 M11）——交付为库能力。

### Key Entities

- **TaskDag**: 节点集 + 依赖边 + 状态视图（就绪/运行中/终态
  计数）；构建即校验。
- **DagNode**: taskId、任务引用、状态（六态）、执行次数、
  失败原因（如执行器报错摘要）。
- **SchedulerConfig**: maxConcurrency（默认 3）、retry（默认
  1），构造时校验合法域。
- **TaskExecutor（端口）**: `execute(task) → Promise<成功|失败>`
  ——M6 RuntimeAdapter 的适配目标。
- **Scheduler**: 调度循环实例——run(dag, executor) → RunOutcome。
- **RunOutcome**: run 终态（completed/failed）+ 每任务 DagNode
  终态 + 失败→skipped 传播链。
- **DispatchRecord**: 派发序列（taskId + 顺序号），确定性断言
  的载体。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 拓扑矩阵（linear / parallel / diamond / cycle /
  missing / self / failure）7 类全部确定性通过或精确拒绝（环
  报出节点链），0 例悬挂或非确定行为。
- **SC-002**: 3 个无依赖 100ms 任务并发调度总耗时 < 200ms
  （串行基线 ≥ 300ms）——真实并发的量化证据。
- **SC-003**: 5 个就绪任务 + maxConcurrency=3：任意时刻
  running ≤ 3（并发峰值采样断言）。
- **SC-004**: 必败任务执行次数恰为 retry+1（默认 2 次）；
  重试即成功的任务终态 completed 且下游照常。
- **SC-005**: 失败传播：failed 的传递依赖 100% skipped 且
  传播链可追溯；run 终态判定 100% 正确（completed/failed/
  空图 completed 三态矩阵）。
- **SC-006**: 同 DAG + 同执行器脚本重复调度：派发序列与全部
  终态逐项一致（确定性）。

## Assumptions

- 执行器是库级注入端口；M5 测试用脚本化假执行器（可控延迟/
  成功/失败/抛异常），不触真实 Runtime（M6 FakeRuntimeAdapter
  适配同一端口）。
- 落位 `packages/scheduler`（roadmap 最终结构），依赖
  `@fleet/mission`（Task 实体与语义规则复用）与 `@fleet/core`。
- 任务状态枚举沿用 M4 TaskRunStatus（pending/running/completed/
  failed/cancelled/skipped）；cancelled 的主动取消语义属 M6+，
  M5 只定义枚举不触发。
- 调度决策串行、执行器调用并发（Node 并发即异步并行）；
  "真实并发"的验收以时间重叠量化（SC-002），不依赖线程语义。
- 无新 CLI、无持久化、无超时机制（FR-010 划界）。
- zero 新增第三方依赖。
