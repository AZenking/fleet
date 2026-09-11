# Feature Specification: M10 Context Builder + Token Budget（角色化上下文与 Token 预算）

**Feature Branch**: `011-m10-context-budget`

**Created**: 2026-09-11

**Status**: Draft

**Input**: User description: "继续" — 对应 `agent-fleet-roadmap.md`
Phase C / M10：Context Builder 按角色定制上下文（Reflex 最小 /
Focus + Repository Intelligence / Reason + Findings + Evidence +
Source + Constraints / Insight + Diff + Validation / Wisdom +
Validation Artifact + Findings + Diff）+ Token Budget（Mission /
Task / Agent 三级预算；记录 inputTokens / outputTokens /
cachedTokens / duration / estimatedCost / contextSize；超预算
Compress → Retry → Reject / Escalate）。roadmap M10 验收锚点：
**Token 可测量、Context 可控制**——"能够按 Agent / Task / Mission
查看 Context 和 Token 消耗，并估算 Context 优化收益"。宪法红线：
禁止把 Full Conversation + Full Repository + All Artifacts 塞给
所有 Agent。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Context Builder 按角色装配 (Priority: P1)

作为 Fleet 的运行时，每个任务派发前由 Context Builder **按角色
规则确定性装配**上下文，而不是把一切塞给模型：Reflex 只拿
Mission 摘要 + Task Goal（最小上下文）；Focus 增加上游 Repository
Intelligence 调查产物；Reason 拿 Mission + 上游 Focus Findings +
Insight Evidence + 相关源码摘录 + 约束；Insight 拿 Mission +
Reason Diff + Validation 结果 + Source + Config；Wisdom 拿
Mission + Validation Artifact + 上游 Findings + Diff（M9 审阅
prompt 至此统一进 Context Builder）。装配产物是**结构化的
Context 包**（分 section、每 section 有来源引用与尺寸），下游
的"全量塞入"在结构上不可能——装配器只接受角色规则声明的
section 类型。

**Why this priority**: Context 构成是 Token 成本与 Agent 质量的
第一决定因素；角色差异化装配是 roadmap 的明文红线（禁止全量
倾倒）与 M10 验收锚点的前半句（Context 可控制）。

**Independent Test**: 五角色各构造一个任务，断言派发请求的
context 构成：Reflex 不含任何 findings/diff/validation section；
Reason 含上游 focus/insight 任务产物而 Wisdom 含 validation
artifact；同 run 内全部 section 有来源可追溯、无"未知来源"段。

**Acceptance Scenarios**:

1. **Given** reflex 任务，**When** 装配上下文，**Then** 仅含
   Mission 摘要与 Task Goal 两类 section（最小面），不含 findings
   / evidence / diff / validation。
2. **Given** reason 任务且其 DAG 上游存在 focus / insight 任务
   （已产出 findings / evidence），**When** 装配，**Then** 上游
   产物按依赖关系注入对应 section（直接上游优先），并附 Relevant
   Source 与 Constraints section。
3. **Given** wisdom 任务（或 M9 审阅执行），**When** 装配，
   **Then** 含 Validation Artifact + 上游 Findings + Diff 摘录
   section——M9 的审阅 prompt 构成不变、来源统一。
4. **Given** insight 任务，**When** 装配，**Then** 含 Reason Diff
   + Validation 结果 + Source + Config section。
5. **Given** 任意角色，**When** 装配完成，**Then** 每一 section
   声明来源（kind + 引用 id），结构化可审计（无来源段 = 装配
   缺陷，测试可断言）。
6. **Given** 上游任务尚无产物（并行执行 / 上游失败被跳过），
   **When** 装配，**Then** 对应 section 缺省标注（如
   unavailable），不阻塞执行、不伪造内容。

---

### User Story 2 - Token 消耗记录与三级聚合 (Priority: P2)

作为 Mission 的运营者，每次 Agent 执行的 Token 消耗被记录：
inputTokens / outputTokens / cachedTokens / duration /
estimatedCost / contextSize（装配后上下文的尺寸）。执行级记录
按 **Agent（单次执行）→ Task（含重试与修复轮次）→ Mission
（全任务聚合）** 三级汇总，随 RunReport 可查——"按 Agent /
Task / Mission 查看 Context 和 Token 消耗"（M10 验收锚点）。
测量尽力而为：运行时不报告 usage 时记录为未知（0 + 标注），
测量缺失不阻塞执行、不伪造数字。

**Why this priority**: 没有测量就没有控制——预算与压缩（US3）
都建立在消耗可见性之上；三级聚合对齐运营视角（单次执行 /
任务 / 任务组）。

**Independent Test**: Fake 运行时按脚本注入确定性 usage →
单任务（含一次修复轮次）跑完 → RunReport.budget 中 task 级 =
两次执行之和、mission 级 = 全任务之和；contextSize 与装配产物
尺寸一致。

**Acceptance Scenarios**:

1. **Given** 一次执行返回 usage（input/output/cached tokens +
   duration），**When** 记录，**Then** Agent 级条目含全部六项
   字段 + 关联（runId / taskId / role）。
2. **Given** 任务经历重试或 M9 修复轮次（多次执行），**When**
   聚合，**Then** Task 级 = 各次执行之和，执行明细保留可查。
3. **Given** mission 含多任务，**When** run 结束，**Then**
   Mission 级聚合 = 全任务之和，随 RunReport.budget 输出。
4. **Given** 运行时不报告 usage，**When** 记录，**Then** 条目标
   注 measured=false（数字为 0），不阻塞、不伪造。
5. **Given** contextSize 字段，**When** 装配与执行完成，**Then**
   contextSize = 实际派发的上下文尺寸（可独立复算验证）。

---

### User Story 3 - 预算强制与优化收益估算 (Priority: P3)

作为 Mission 的预算守护者，装配的上下文超过预算时按确定性
阶梯处理：**Context Too Large → Compress（按 section 优先级
截断 / 摘录）→ 复检（仍超则再压）→ 仍超 → Reject /
Escalate**（任务失败，结构化报告超预算明细——含各 section
尺寸，供人工拆分任务或提额）。预算来源 = mission / task 级
maxTokens 约束（M4 既有）。同时报告**优化收益估算**：对每次
装配输出"全量可得材料 vs 实际装配"的对比统计（各 section
原始尺寸 / 装配后尺寸 / 节省比例）——回答"如果不用角色化
装配会花多少"。

**Why this priority**: 预算是"Context 可控制"的强制面；优化
收益估算让角色化装配的价值可量化（验收锚点后半句），为后续
调优提供数据。

**Independent Test**: 大 findings 产物 + 小预算 mission：装配先
超预算 → 压缩后合规（断言 section 被截断且总尺寸 ≤ 预算）；
预算设为不可能小 → Reject/Escalate 终态（结构化明细）；正常
装配输出节省统计（原始 > 装配后）。

**Acceptance Scenarios**:

1. **Given** 装配产物超过 task / mission 级 maxTokens 预算，
   **When** 装配，**Then** 先按 section 优先级压缩（低优先级
   先截、高优先级保头尾摘录），压缩确定性可复现。
2. **Given** 一轮压缩后仍超预算，**When** 复检，**Then** 继续
   压缩更高优先级 section（有限轮次，默认 2 轮），全程零 LLM
   参与（规则压缩，宪法 V）。
3. **Given** 压缩轮次耗尽仍超预算，**When** 终止，**Then**
   Reject/Escalate：任务失败（终态、不重试），报告含逐 section
   尺寸明细 + 预算值（供人工决策）。
4. **Given** 任意成功装配，**When** 产出统计，**Then** 每次装配
   记录原始材料总尺寸 vs 装配后尺寸 vs 节省比例，mission 级
   汇总进报告（优化收益估算）。
5. **Given** 无预算约束的 mission，**When** 装配，**Then** 不
   压缩、不报错（预算是可选强制，缺省只测量）。

---

### Edge Cases

- 上游产物缺失（并行 / 跳过 / 失败）：section 标注
  unavailable，不伪造、不阻塞。
- 上游产物本身超大（findings 大于预算）：压缩阶梯处理；
  Reject 明细指出元凶 section。
- 同一上游被多个下游引用：各下游独立装配（无共享缓存——
  M10 不引入 Context Cache，属后续优化）。
- 修复轮次（M9）的再执行：重新装配（可能纳入前轮审阅意见
  ——M9 的 feedback 通道保持，作为附加 section）。
- Reflex 轻写任务的修复轮次：同样最小上下文 + feedback section。
- usage 含异常值（负数 / NaN / 超 int）：钳制或标注无效，
  不进聚合（测量卫生）。
- 压缩边界：截断不得产生损坏结构（JSON / diff 片段截断需
  闭合或标注 truncation marker）。
- contextSize 的度量口径：以装配产物字符串长度的确定换算
  （字符 → token 估算系数），口径写死并全链一致（口径可配、
  缺省固定）。
- 预算为 0：合法——任何非空装配即 Reject（纯调度占位语义）。
- 多级预算并存（mission 与 task 同设）：task 级优先（更紧的
  约束生效），明细标注生效层级。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: ContextBuilder MUST 按角色规则确定性装配上下文：
  每角色一份声明式 section 清单（reflex 最小 / focus + 调查产物 /
  reason + 上游 findings + evidence + source + constraints /
  insight + diff + validation + source + config / wisdom +
  validation artifact + findings + diff），装配产物为结构化
  Context 包（section + 来源 + 尺寸）。
- **FR-002**: 装配 MUST 结构性排除全量倾倒：只有角色规则声明
  的 section 类型可进入 Context 包；Full Conversation / Full
  Repository / All Artifacts 整体不可作为输入（宪法红线，
  测试可断言）。
- **FR-003**: 上游产物注入 MUST 按 DAG 依赖解析（直接上游
  优先）；上游缺失 → section 标注 unavailable（不伪造不阻塞）。
- **FR-004**: M9 的 Wisdom 审阅上下文 MUST 迁移到 Context
  Builder 统一装配（审阅 prompt 构成不回退，M9 e2e 保持绿）。
- **FR-005**: Token 消耗 MUST 按执行记录（inputTokens /
  outputTokens / cachedTokens / duration / estimatedCost /
  contextSize + 关联 id），并按 Agent → Task → Mission 三级
  聚合进 RunReport.budget。
- **FR-006**: usage 测量 MUST 尽力而为：运行时不报告 → 条目
  measured=false（0 值 + 标注），不阻塞执行；异常值钳制或
  标注，不进聚合。
- **FR-007**: 预算强制 MUST 接入 mission / task 级 maxTokens
  约束（M4 既有 kind；task 级优先）：超预算 → 规则压缩（section
  优先级 + 头尾摘录，有限轮次默认 2，零 LLM）→ 复检 → 仍超
  → Reject/Escalate 终态（不重试），报告逐 section 尺寸明细。
- **FR-008**: 每次装配 MUST 输出优化收益统计：原始材料尺寸 vs
  装配后尺寸 vs 节省比例，mission 级汇总（验收锚点"估算
  Context 优化收益"）。
- **FR-009**: contextSize 的 token 估算口径 MUST 全链一致
  （确定换算、缺省固定、可配置），报告值可独立复算验证。
- **FR-010**: Agent 执行请求 MUST 携带装配产物（确定性模板，
  替换 M7 的手写模板拼接），修复轮次的 feedback 作为附加
  section 注入。
- **FR-011**: 断言以 FakeRuntimeAdapter 驱动（脚本化 usage 注入
  与产物输出）；e2e 不引入真实 LLM；零新增第三方依赖。

### Key Entities

- **ContextSection**: kind（mission / taskGoal / findings /
  evidence / source / constraints / diff / validation / feedback /
  config）、source（引用 id）、content、sizeTokens、priority、
  truncated 标注。
- **ContextPackage**: taskId、role、sections[]、totalTokens、
  budget（生效值 + 层级）、compression 轮次、optimization
  （原始 vs 装配后 vs 节省）。
- **UsageRecord（Agent 级）**: 执行关联（runId / taskId / role）、
  inputTokens / outputTokens / cachedTokens / durationMs /
  estimatedCost / contextSize、measured 标注。
- **BudgetSummary（Task / Mission 级）**: 聚合 usage + 执行次数
  + optimization 汇总。
- **BudgetRejection**: 生效预算、层级、逐 section 尺寸明细、
  压缩轮次（Reject/Escalate 的结构化载体）。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 五角色装配矩阵 100% 符合角色规则（reflex 零多余
  section、reason/wisdom/insight 各自必含项 100% 命中、全
  section 来源可追溯）——库级断言全绿。
- **SC-002**: 全量倾倒不可能：非角色声明类型注入尝试在类型层
  被拒绝（编译期/装配期结构断言），运行时 Context 包中零
  "未知来源"段。
- **SC-003**: 三级聚合正确性：含重试 / 修复轮次的任务，Task
  级 = 执行之和、Mission 级 = 任务之和，e2e 断言全绿；未测量
  执行 100% 标注 measured=false。
- **SC-004**: 预算阶梯：超预算 → 压缩后合规（总尺寸 ≤ 预算、
  截断可复现）；不可压缩预算 → Reject/Escalate 终态（不重试、
  明细完整）；无预算 → 零压缩零报错。
- **SC-005**: 优化收益可量化：每次装配输出三段统计（原始 /
  装配后 / 节省比例），mission 级汇总进 RunReport。
- **SC-006**: M9 审阅迁移零回退：M9 全部 e2e（含验收锚点
  SC-001 自报矛盾）保持绿；审阅上下文 section 构成与 M9 等
  价或更丰富（不缺项）。
- **SC-007**: 派发请求 100% 携带结构化 Context 包（替换手写
  拼接），修复轮次含 feedback section。

## Assumptions

- 落位 `packages/context`（roadmap 最终结构的 context 包）+
  `packages/budget`（budget 包）；依赖 core / mission / runtime
  / agents / workspace（diff 来源）/ validation（artifact 来源）。
- 上游产物的运行时载体 = run 内内存 Artifact 注册表（任务执行
  输出按 taskId 收集，M4 artifactSchema 形态）；跨进程持久化
  属 M11（.fleet/runs/）。
- token 估算口径：字符数 → token 的固定系数换算（缺省约 4
  字符/token，可配置）；精确 tokenizer 不引入（零依赖红线）。
- estimatedCost：token 数 × 可配置单价表（缺省 0——无单价则
  只计数不计价；单价配置属使用侧）。
- Repository Intelligence 产物进 context 的接缝 = 上游任务
  输出（investigate 类任务的 findings）；M10 不直接调用
  repository 包做即时调查（那是任务执行的事，不是装配的事）。
- CLI 适配器的 usage 解析尽力而为（ recognizable 输出格式才
  解析）；Fake 提供确定性注入（CI 确定性，宪法 IV）。
- 压缩策略为纯规则（按 section 优先级截断 + 头尾保留 + 标注），
  无 LLM 摘要（LLM 压缩属 Fleet 1.0 后优化）。
- 无新 CLI 命令（RunReport 增强；`fleet run --json` 即查看面）。
