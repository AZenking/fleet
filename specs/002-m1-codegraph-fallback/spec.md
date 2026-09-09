# Feature Specification: M1 CodeGraph + Fallback（仓库调查链路）

**Feature Branch**: `002-m1-codegraph-fallback`

**Created**: 2026-09-09

**Status**: Draft

**Input**: User description: "开始完整第二步骤（M1 CodeGraph + Fallback）" —
对应 `agent-fleet-roadmap.md` Phase A / M1：建立 Repository Investigation
的第一条完整链路。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 提问即调查 (Priority: P1)

作为 Fleet 开发者（或 Codex Desktop 会话），我对目标仓库提出一个
调查问题（如 "AuthService 的登录流程怎么走"），运行
`fleet repo investigate "<问题>"`，得到一份调查结果：相关符号、文件
位置、调用关系与关键代码片段。CodeGraph 健康时，结果以结构化证据
（符号 + 位置）为主，速度快、无需全文阅读。

**Why this priority**: 这是 Repository Intelligence 的第一条价值链路
——M1 的存在理由；没有它，后面所有智能层都没有载体。

**Independent Test**: 在 CodeGraph 可用的仓库中运行
`fleet repo investigate "FleetError 在哪里被抛出"`，检查返回的
references 是否真实存在于源码中。

**Acceptance Scenarios**:

1. **Given** 一个已建立 CodeGraph 索引的仓库，**When** 运行
   `fleet repo investigate "<问题>"`，**Then** 返回非空调查结果，
   每条 reference 都包含文件路径与位置，且实际指向存在的代码。
2. **Given** 调查完成，**When** 查看 `--json` 输出，**Then** 结果
   标明本次服务路径（codegraph）与耗时，退出码 0。
3. **Given** 仓库中不存在与问题相关的任何内容，**When** 调查完成，
   **Then** 返回空结果并明确说明"未找到相关内容"，退出码仍为 0
   （无结果 ≠ 调查失败）。

---

### User Story 2 - 无缝降级 (Priority: P2)

作为 Fleet 开发者，当 CodeGraph 不可用、超时、索引过期、符号缺失/
歧义、结果为空、或与源码冲突时，investigate **自动**降级到原生搜索
（ripgrep）与源码阅读，照样返回有源码证据的结果；降级原因被结构化
记录。调查永远不会因为 CodeGraph 的问题而直接失败。

**Why this priority**: 这是宪法原则 I（加速器不是硬依赖）的第一个
可执行落点，也是 M1 验收标准的核心——"调查不能因 CodeGraph 不可用
直接失败"。

**Independent Test**: 用故障注入矩阵（关闭 codegraph、注入超时、
stale 索引、查询不存在的 symbol、同名 symbol）逐项验证：每项都
自动降级、仍返回结果、fallback 原因可查。

**Acceptance Scenarios**:

1. **Given** PATH 中没有 codegraph（或探测失败），**When** 运行
   investigate，**Then** 走 search → source 路径返回结果，报告中
   fallback 原因为 unavailable，退出码 0。
2. **Given** CodeGraph 响应超过超时阈值，**When** 运行 investigate，
   **Then** 在阈值后放弃等待并降级，总耗时不失控，不悬挂。
3. **Given** 索引落后于工作区当前状态（stale），**When** 调查引用了
   CodeGraph 结果，**Then** 关键 reference 经源码复核，冲突时以源码
   为准并记录 conflict 降级。
4. **Given** 同名 symbol 存在多个候选，**When** CodeGraph 返回歧义
   结果，**Then** 记录 ambiguous 并经搜索/源码补充上下文，结果中
   列出全部候选而非随机取一。
5. **Given** 故障注入矩阵的任一场景，**When** 调查结束，**Then**
   `--json` 输出包含结构化 fallback 记录（code + detail）。

---

### User Story 3 - 适配层隔离与调查策略 (Priority: P3)

作为后续里程碑（M2 Wiki、M3 Evidence）与 Fleet 内部的消费者，我依赖
一个稳定的 CodeGraph 适配层与一个基于规则的调查策略：适配层封装已
安装 CodeGraph 的能力（search / explore / symbol / callers / callees /
impact / health），其不可用、报错、索引异常都以统一结构暴露；策略
决定"结果是否可信、何时升级"，我不需要知道底下是哪个版本、哪种
接入方式。

**Why this priority**: 宪法原则 IV 的解耦精神在 Repository 侧的落点；
没有它，每次 CodeGraph 升级都会波及全部消费者，M2/M3 也无法在其上
构建。

**Independent Test**: 用一个行为可控的假 CodeGraph 实现（脚本化
成功/失败/超时/歧义）驱动同一套 investigate 流程，验证消费者行为
不因后端替换而改变。

**Acceptance Scenarios**:

1. **Given** 适配层后端被替换（真实 CodeGraph ↔ 假实现），**When**
   运行同一组调查，**Then** 消费者（investigate 命令与策略）无需
   修改，行为仅由后端返回内容决定。
2. **Given** 高风险模式的问题（动态调用 / 反射 / 依赖注入 / 框架
   魔法 / 生成代码 / 配置驱动行为），**When** CodeGraph 已返回结果，
   **Then** 策略仍升级到源码复核，最终证据锚定在真实源码位置
   （宪法：Static Truth = Source + Config）。
3. **Given** 适配层健康检查，**When** 查询其状态，**Then** 返回
   结构化健康信息（是否可用、索引是否新鲜、支持的能力列表）。
4. **Given** 原生搜索工具（如 ripgrep）也不可用，**When** 调查执行，
   **Then** 仍可通过纯文件遍历的源码阅读返回结果（最终兜底是
   文件系统本身），并如实标注 degraded 路径。

---

### Edge Cases

- CodeGraph 命令存在但调用即崩溃 / 返回非预期格式：按 error 降级，
  investigate 本身不崩溃。
- 问题命中生成的代码或构建产物目录：默认排除常见的产物目录，
  可被显式包含。
- 大仓库全量搜索的耗时：原生搜索路径必须有结果条数与超时上限，
  不做无限扫描。
- 非 git 仓库 / 非 UTF-8 文件 / 二进制文件：跳过并记录，不失败。
- 问题为空或纯符号名（如 "FleetError"）：符号名直接走 symbol 查询
  路径。
- CodeGraph 与源码对同一位置的描述不一致：源码胜出（Static Truth），
  冲突被记录。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `fleet repo investigate "<question>"` MUST 产出调查结果：
  与问题相关的 references（文件路径 + 位置 + 符号 + 代码片段），
  并支持 `--json` 结构化输出，退出码语义与既有 CLI 契约一致
  （0 = 完成，1 = 调查自身失败，2 = 用法错误）。
- **FR-002**: 每个调查结果 MUST 记录服务路径（codegraph / search /
  source 及其组合）、耗时，以及发生降级时的结构化原因
  （code + detail）。
- **FR-003**: 对 CodeGraph 的全部访问 MUST 经由适配层；适配层
  MUST 以统一能力面（search / explore / symbol / callers / callees /
  impact / health）与统一结果/错误结构暴露，消费者 MUST NOT 依赖
  具体安装版本或接入方式。
- **FR-004**: 适配层的失败（不可用、超时、协议错误、索引过期、
  解析错误）MUST 以结构化失败结果返回，MUST NOT 让 investigate
  进程崩溃或悬挂。
- **FR-005**: CodeGraph 任何形态的失败或不可信 MUST 触发自动降级：
  原生搜索 → 源码阅读；调查 MUST NOT 因 CodeGraph 不可用直接失败
  （宪法原则 I）。
- **FR-006**: 降级触发 MUST 至少覆盖：不可用/超时/错误、索引过期、
  symbol 缺失、symbol 歧义、意外空结果、与源码冲突。
- **FR-007**: 高风险模式（动态调用、反射/DI、框架魔法、生成代码、
  配置驱动行为）MUST 升级源码复核，即使 CodeGraph 已给出结果。
- **FR-008**: 结果中的关键证据 MUST 锚定到真实源码位置（文件 +
  位置）；结构化引用（来自 CodeGraph）单独标注，不冒充源码证据。
- **FR-009**: 原生搜索 MUST 有结果条数上限与超时；搜索工具缺失时
  MUST 降级为纯文件遍历扫描并标注 degraded。
- **FR-010**: 常见构建产物目录 MUST 默认排除在调查范围之外。
- **FR-011**: 调查策略 MUST 是确定性规则（无 LLM 参与），升级决策
  可复现、可解释。

### Key Entities

- **InvestigationRequest**: 问题文本、可选范围限定（路径/文件类型）、
  可选模式提示。
- **InvestigationResult**: 问题、references 列表、服务路径、
  fallback 记录（0..n 条，code + detail）、耗时、结论摘要。
- **Reference**: 文件路径、位置（行/范围）、符号名（如有）、片段、
  来源（codegraph / search / source）。
- **CodeGraphAdapter（能力面）**: search / explore / symbol /
  callers / callees / impact / health；输入输出为稳定结构。
- **CodeGraphHealth**: 可用性、索引新鲜度、能力列表、版本信息。
- **FallbackReason**: code（unavailable / timeout / error / stale /
  missing_symbol / ambiguous / empty / conflict / high_risk）+ detail。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 在 CodeGraph 健康的仓库上，常规调查问题在 10 秒内返回
  结果。
- **SC-002**: 故障注入矩阵（不可用、超时、stale、缺 symbol、同名
  symbol、空结果、冲突）下 100% 自动降级且仍返回带源码证据的结果，
  0 例直接失败。
- **SC-003**: 每次降级都能从输出中读出 code + detail 的结构化原因。
- **SC-004**: 抽查结果中的 references，100% 锚定到真实存在的源码
  位置。
- **SC-005**: 更换适配层后端（真实 ↔ 假实现）不需要修改 investigate
  命令与策略的任何代码。

## Assumptions

- 本机已安装 CodeGraph（M0 doctor 探测为可用）；具体接入方式
  （CLI / MCP / 本地服务）属 plan/research 决策，本 spec 只约束
  适配层的行为契约。
- 落位遵循 roadmap 的 packages/repository 结构（codegraph /
  fallback / investigation 三模块），复用 M0 core 的 probe / fs /
  errors / logging 能力。
- 原生搜索优先使用 ripgrep；缺失时降级为内置文件遍历扫描
  （性能牺牲换取可用性）。
- 语义化的"问题理解"（把自然语言问题变成检索策略）在本里程碑采用
  确定性规则（关键词/符号提取），LLM 参与是后续里程碑范围。
- Evidence 置信度、FAST/VERIFY 模式、Conflict Resolver 的完整体系
  是 M3 的范围；M1 只需要可解释的降级记录。
- Wiki（M2）不在本里程碑范围。
