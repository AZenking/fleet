# Feature Specification: M4 Core Domain（任务域实体与校验）

**Feature Branch**: `005-m4-core-domain`

**Created**: 2026-09-11

**Status**: Draft

**Input**: User description: "开始下一步" — 对应
`agent-fleet-roadmap.md` Phase B / M4：实现 Mission / Task / Artifact /
Run 核心域实体与 `fleet mission validate` 校验链，为 M5（DAG +
Scheduler）与 M6（RuntimeAdapter + Fake Agents）提供地基。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 编写并校验 Mission (Priority: P1)

作为 Fleet 开发者（或 Codex Desktop 会话），我把一个已经明确的
任务写成 mission 文件（goal、requirements、constraints、
acceptance、planningMode、tasks），运行
`fleet mission validate ./missions/demo.yaml`，得到完整校验结果：
合法文件通过并展示摘要（目标、任务数、验收条数、执行模式）；
非法文件逐条列出全部错误——每个错误带字段路径与修复提示，
不需要读源码就能定位问题。

**Why this priority**: Mission 是 Fleet Kernel 的输入契约——M5 调度、
M6 运行、M7+ 全部 Agent 执行都以它为起点；没有可信的输入校验，
后面每一层的失败都会变成运行时排障。

**Independent Test**: 在本仓库编写合法 `missions/demo.yaml` 运行
validate（退出码 0）；再逐项注入故障（缺 goal / 非法角色 / 悬空
依赖 / 重复 id），每项都得到带字段路径的错误（退出码 1）。

**Acceptance Scenarios**:

1. **Given** 一个字段齐全、引用一致的合法 mission 文件，**When**
   运行 `fleet mission validate <path>`，**Then** 校验通过（退出码
   0），输出摘要含 goal、任务数、验收条数、planningMode。
2. **Given** 缺少必填字段的文件，**When** 校验，**Then** 退出码 1，
   错误逐条列出（含 `goal`、`requirements` 等字段路径），一次性
   报出全部问题而非首错即停。
3. **Given** 含未知字段的文件（如拼写错误 `acceptences`），**When**
   校验，**Then** 被拒绝并提示未知字段——拼写错误不得静默丢失。
4. **Given** 文件不是合法文档格式 / 不存在 / 不可读，**When**
   校验，**Then** 文件级错误信息明确（不崩溃、退出码 1）。
5. **Given** 同一文件重复校验，**When** 对比两次输出，**Then**
   结果完全一致（确定性）。

---

### User Story 2 - 执行模式语义 (Priority: P2)

作为 Codex Desktop 会话，我在两种 planningMode 下写 mission：
`execution`（方案已与我确认，Fleet 只负责执行拆解，不得推翻方案）
与 `autonomous`（只有需求，允许 Reason 规划）。validate 按模式
校验结构完备性：**execution 必须携带已确认的 plan 与非空 tasks；
autonomous 的 plan / tasks 可空**（留给 Reason 规划产生）。模式的
差异在错误信息中明确说明（"execution 模式要求……"）。

**Why this priority**: planningMode 是宪法原则 V 的直接落点
（`execution` 下 Reason MUST NOT 推翻已确认方案）——输入契约在
M4 把模式语义钉死，M7 的 Agent 行为约束才有依据。

**Independent Test**: 同一任务分别以两种模式写成两个文件：
execution 版缺 plan → 明确报错；autonomous 版无 plan 无 tasks →
通过。

**Acceptance Scenarios**:

1. **Given** `planningMode: execution` 且 plan 与 tasks 齐全，
   **When** 校验，**Then** 通过。
2. **Given** `planningMode: execution` 且缺 plan（或 tasks 为空），
   **When** 校验，**Then** 错误指明 execution 模式的要求（方案已
   确认的 mission 必须携带 plan 与任务拆解）。
3. **Given** `planningMode: autonomous` 且只有 requirements（无
   plan、无 tasks），**When** 校验，**Then** 通过（任务由 Reason
   规划产生是合法状态）。
4. **Given** planningMode 缺失或非法值（如 `Execution`、`auto`），
   **When** 校验，**Then** 枚举错误并列出合法值。

---

### User Story 3 - 任务结构与关联校验 (Priority: P3)

作为 M5 Scheduler 的开发者，我依赖 validate 对 tasks 的静态校验：
id 唯一、agentRole 是五个认知角色（reflex / focus / reason /
insight / wisdom）之一、dependsOn 引用的 id 存在且不指向自身。
Artifact 与 Run 实体在本里程碑定义为已校验的 schema（消费方是
M5/M6），mission 文件不携带其实例。

**Why this priority**: Task 是 DAG 的节点——id / 依赖 / 角色的静态
错误必须在入口拦截，M5 才能专注于图语义（环检测、就绪选择、
失败传播）而非字段检查。

**Independent Test**: 注入重复 task id、非法角色（如 `coder`）、
悬空依赖（dependsOn 不存在的 id）、自环依赖四种故障，逐项断言
错误信息与字段路径。

**Acceptance Scenarios**:

1. **Given** 两个任务同 id，**When** 校验，**Then** 错误标明
   `tasks[].id` 重复及两个冲突位置。
2. **Given** agentRole 不在五角色枚举内，**When** 校验，**Then**
   枚举错误并列出合法角色。
3. **Given** dependsOn 引用不存在的 id，**When** 校验，**Then**
   悬空依赖错误（标明引用方与被引用 id）。
4. **Given** 任务依赖自身，**When** 校验，**Then** 自环错误
   （多节点成环检测属 M5 DAG 模块，不在本里程碑）。
5. **Given** acceptance 为空或某条不完整（缺 given/when/then 任一
   段），**When** 校验，**Then** 验收标准错误（Mission 必须有可
   验证的验收）。

---

### Edge Cases

- 空 requirements / 空 goal：goal 必填非空；requirements 至少一条
  （"没有需求的任务"无法验收）。
- constraints 参数与类型不符（如 maxTokens 给了负数 / 非数值）：
  类型化校验报错。
- 多文档 YAML 文件（--- 分隔多个对象）：拒绝并说明只接受单
  mission。
- 顶层为数组而非对象：结构错误明确提示。
- 非 UTF-8 / 二进制文件：文件级错误，不崩溃。
- mission id 不符合命名约定（建议 `[a-z0-9-]`，具体规则实现定）：
  非空必查，格式规则由 plan 确定。
- tasks 中混入非对象项：逐项定位（`tasks[2]` 级字段路径）。
- 文件路径是目录：明确提示需要文件路径。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `fleet mission validate <path>` MUST 校验 mission 文件
  并输出结果：文本模式逐条列出错误（字段路径 + 原因 + 修复提示），
  `--json` 输出结构化校验报告；退出码 0（通过）/ 1（校验失败或
  文件不可读）/ 2（用法错误），与全局契约一致。
- **FR-002**: Mission 实体 MUST 校验 id / goal / requirements /
  constraints / acceptance / planningMode / plan? / tasks? 全部
  字段；未知字段 MUST 拒绝（防拼写错误静默丢失）。
- **FR-003**: planningMode MUST ∈ {autonomous, execution}；
  execution MUST 同时具备 plan 与非空 tasks；autonomous 的
  plan / tasks 可选；模式差异 MUST 体现在错误信息中。
- **FR-004**: Task MUST 校验：id 在 mission 内唯一、agentRole ∈
  五角色枚举、dependsOn 引用存在的 id 且不含自身；多节点环检测
  属 M5，本里程碑不做。
- **FR-005**: AcceptanceCriteria MUST 非空，每条含完整的
  given / when / then 三段。
- **FR-006**: Constraint MUST 类型化：kind ∈ 内建枚举（至少
  maxDurationMs / maxTokens），参数按类型校验（数值 ≥ 0 等）；
  未知 kind 拒绝。
- **FR-007**: 校验 MUST 一次性报出全部错误（不首错即停），每条
  错误含字段路径；同一文件重复校验结果一致（确定性）。
- **FR-008**: Artifact 与 Run 实体 MUST 定义 schema 并可被独立
  校验（消费方为 M5/M6）；mission 文件不携带其实例，validate 不
  涉及。
- **FR-009**: Requirement 至少一条；每条非空；id（如有）在
  mission 内唯一。
- **FR-010**: 仓库级约定：mission 文件位于 `missions/` 目录
  （默认查找），显式路径可指向任意位置；单文件单 mission。

### Key Entities

- **Mission**: id、goal、planningMode（autonomous/execution）、
  requirements[]、constraints[]、acceptance[]、plan?、tasks?。
- **Plan**: 已确认的执行方案（步骤/任务分解的载体，execution
  模式必填；内部结构由 plan 阶段细化）。
- **Task**: id、goal、agentRole（五角色）、dependsOn[]、可选
  约束与验收覆盖。
- **Requirement**: id?、内容（非空文本）。
- **Constraint**: kind（内建枚举）+ 类型化参数。
- **AcceptanceCriteria**: given / when / then 三段。
- **Artifact**: Agent 间结构化交换产物（schema 定义于本里程碑，
  实例由 M5/M6 产生）。
- **Run**: 一次 mission 执行的记录实体（同上，实例归 M5/M6）。
- **MissionValidationReport**: ok + 错误列表（字段路径 / 原因 /
  修复提示）。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 合法 mission 文件校验通过并输出摘要（goal / 任务数 /
  验收条数 / planningMode），耗时 < 1s。
- **SC-002**: 故障注入矩阵（缺 goal / 空验收 / 非法 planningMode /
  execution 缺 plan / 重复 task id / 非法角色 / 悬空依赖 / 自环 /
  未知字段 / 非法约束参数，共 10 类）100% 产生含字段路径的错误，
  0 例崩溃或静默通过。
- **SC-003**: 多错误文件一次报出全部错误（数量与注入一致，无
  遗漏）。
- **SC-004**: 同文件重复校验输出逐字节一致（确定性）。
- **SC-005**: 错误信息自解释：仅凭错误输出（不看源码）能修复
  注入矩阵中的每类故障（走查验证）。

## Assumptions

- mission 文件格式为 YAML（roadmap CLI 示例既定）；具体 schema
  与字段命名细则由 plan 阶段的 data-model 定，本 spec 约束语义
  与校验行为。
- 落位遵循 roadmap 的 `packages/mission`（新包）；复用 M0 core
  的 config 加载模式（Zod + YAML）与错误模型，零新增第三方依赖。
- Task 的图语义（拓扑排序、就绪选择、环检测、失败传播）全部是
  M5 范围；M4 只保证"每个 task 节点静态合法、引用闭合"。
- Artifact / Run 在本里程碑是 schema + 单元校验，不产生运行时
  实例（无 DB、无持久化——Run 持久化在 M11）。
- Agent 角色执行期权限（READ ONLY / WRITE 强制）是 M7/M8 的
  Runtime / Workspace 职责；M4 只校验角色枚举合法性。
- `missions/` 目录在本里程碑落地（含 demo mission 作为夹具与
  文档）；批量校验（`fleet mission validate --all`）不在此范围。
- 不做 mission 模板 / 跨文件引用 / 加密——单文件自包含。
