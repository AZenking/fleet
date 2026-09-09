# Feature Specification: M0 Foundation（工程基线）

**Feature Branch**: `001-m0-foundation`

**Created**: 2026-09-09

**Status**: Draft

**Input**: User description: "开始第一个内容（M0 Foundation）" — 对应
`agent-fleet-roadmap.md` Phase A / M0：建立 Agent Fleet Monorepo 和基础
工程能力。

## Clarifications

### Session 2026-09-09

- Q: `fleet doctor` 的诊断报告是否必须支持机器可读输出（JSON），还是
  只需人类可读文本？ → A: 双格式：默认人类可读，`--json` 输出结构化
  报告，两种模式退出码语义一致。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 一键质量门 (Priority: P1)

作为 Fleet 开发者，我在全新克隆的仓库里执行一条命令，就能完成依赖
安装并通过静态检查与全部测试；任何违规或失败都会让命令以非零退出码
结束并指出具体位置。我不需要任何手工配置步骤。

**Why this priority**: 后续所有 Milestone（M1 起）都必须在绿色流水线上
开发；没有可一键复现的质量门，一切验收标准都无从谈起。这是 M0 的
存在理由。

**Independent Test**: 全新克隆仓库 → 运行安装命令 → 运行检查命令 →
观察退出码与输出。单独交付此故事即构成可用的 MVP。

**Acceptance Scenarios**:

1. **Given** 一台装有受支持运行时的新机器和全新克隆的仓库，**When**
   开发者依次执行安装与检查命令，**Then** 依赖安装成功、静态检查与
   测试全部通过，命令退出码为 0。
2. **Given** 仓库中存在风格违规或失败测试的代码，**When** 开发者执行
   检查命令，**Then** 命令以非零退出码失败，并逐条指出违规文件/用例
   与原因。
3. **Given** 本地包之间的相互引用，**When** 执行检查命令，**Then** 所有
   工作区内的包被一起检查，无一遗漏。

---

### User Story 2 - 环境诊断 fleet doctor (Priority: P2)

作为 Fleet 开发者，我运行 `fleet doctor`，即可获得一份环境诊断报告：
运行时版本、Git 可用性、目标仓库识别、Fleet 配置存在性与有效性、
CodeGraph 可用性、Agent Runtime 可用性。全部关键项通过时明确告知
"环境就绪"；关键项缺失时逐项给出修复建议并以非零退出码结束。

**Why this priority**: M1 起每个 Milestone 都依赖环境差异排查（尤其
是 CodeGraph 的有无）。doctor 把"环境是否满足"从口口相传变成一条
命令，同时用 warning/error 分级落实宪法原则 I（加速器不是硬依赖）。

**Independent Test**: 在健康环境与人为破坏的环境（低版本运行时、
非 git 目录、损坏配置）下分别运行 `fleet doctor`，对比报告与退出码。

**Acceptance Scenarios**:

1. **Given** 健康环境（受支持的运行时版本、git 可用、合法配置），
   **When** 运行 `fleet doctor`，**Then** 报告所有关键项 ok，输出
   "环境就绪"，退出码 0。
2. **Given** 运行时版本低于要求，**When** 运行 `fleet doctor`，
   **Then** 该项标记为 error，给出修复建议，退出码非 0。
3. **Given** CodeGraph 或任何 Agent Runtime 未安装/不可用，**When**
   运行 `fleet doctor`，**Then** 这些项仅标记为 warning 并说明"可
   降级，不影响 Fleet 可用"，整体仍判定环境就绪。
4. **Given** Fleet 配置文件缺失或字段非法，**When** 运行
   `fleet doctor`，**Then** 错误信息定位到具体字段并给出期望格式。
5. **Given** 在非 git 仓库目录运行 `fleet doctor`，**When** 诊断完成，
   **Then** 仓库识别项标记为 error 并说明需要在一个 git 仓库内运行。
6. **Given** 任意环境（健康或不健康），**When** 运行 `fleet doctor --json`，
   **Then** 输出可被机器解析的结构化报告（与 DiagnosticReport 实体
   一致），退出码语义与文本模式完全一致。

---

### User Story 3 - 共享基础能力包 (Priority: P3)

作为后续 Milestone 的开发者，我从 core 包直接引用一组被测试覆盖的
基础能力：配置加载与 Schema 校验、统一错误模型、日志接口、事件
接口、ID 生成、文件系统抽象、Git 仓库检测。我不需要为 M1 再写任何
工程底座代码。

**Why this priority**: M1（CodeGraph Adapter + Fallback）的第一行业务
代码就要用到配置、错误模型和事件。基础能力先行可以让后续每个里程碑
只写业务差异。

**Independent Test**: 用一份合法样例配置和一份非法样例配置调用配置
加载能力，验证成功路径返回结构化配置、失败路径返回逐字段错误。

**Acceptance Scenarios**:

1. **Given** 一份合法的 Fleet 配置样例，**When** 调用配置加载能力，
   **Then** 返回结构化配置对象。
2. **Given** 一份缺字段或类型错误的配置样例，**When** 调用配置加载
   能力，**Then** 抛出统一错误模型的异常，错误信息逐字段指明问题。
3. **Given** 任意两个新生成的 ID，**When** 比较，**Then** 二者不同
   且格式稳定。
4. **Given** 一个 git 仓库目录与一个普通目录，**When** 调用 Git 仓库
   检测能力，**Then** 前者被识别为仓库（含根路径），后者明确返回
   "非 git 仓库"。

---

### Edge Cases

- 运行时版本恰好等于最低要求版本时：MUST 判定通过（>= 语义）。
- 配置文件存在但为空文件：按非法配置处理，错误信息说明"配置为空"。
- CodeGraph 命令存在但调用超时/崩溃：按"不可用"处理（warning），
  不能让 doctor 本身崩溃或挂起。
- `fleet doctor` 在 monorepo 子目录内运行：应仍能定位到仓库根。
- 事件接口在本阶段只需定义与可序列化，不要求持久化落地（M11 范围）。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 仓库 MUST 提供单命令质量门：一条命令完成依赖安装，
  另一条命令（或同一命令）执行静态检查与全部测试；任何失败 MUST
  导致非零退出码并逐条定位问题。
- **FR-002**: 质量门 MUST 在全新克隆的仓库上无需手工步骤直接可用。
- **FR-003**: `fleet doctor` MUST 检查：运行时版本（不低于项目声明的
  最低版本）、Git 可用性、目标 git 仓库识别、Fleet 配置存在性与
  Schema 有效性。
- **FR-004**: `fleet doctor` 对 CodeGraph 与 Agent Runtime 可用性
  MUST 仅输出 warning，MUST NOT 因其缺失而判定环境不就绪（宪法
  原则 I：加速器不是硬依赖）。
- **FR-005**: `fleet doctor` 的报告 MUST 逐项给出 ok / warning / error
  状态；存在 error 时退出码非 0 且每项 error 附带修复建议。
- **FR-006**: core 包 MUST 提供并被测试覆盖：配置加载与 Schema 校验、
  统一错误模型、日志接口、事件接口、ID 生成、文件系统抽象、Git
  仓库检测。
- **FR-007**: 所有配置与数据文件格式 MUST 有对应 Schema；校验失败
  MUST 产出结构化、逐字段的错误信息。
- **FR-008**: monorepo 工作区 MUST 覆盖 apps 与 packages 两类成员，
  并支持后续 Milestone 增量添加子包而无需修改质量门。
- **FR-009**: `fleet` CLI MUST 支持打印自身版本号。
- **FR-010**: 文件系统抽象 MUST 使核心逻辑可在不触碰真实磁盘的
  前提下被测试。
- **FR-011**: `fleet doctor` MUST 默认输出人类可读报告，并支持
  `--json` 输出与 DiagnosticReport 实体一致的结构化 JSON；两种模式的
  退出码语义 MUST 完全一致。

### Key Entities

- **FleetConfiguration**: 全局配置（配置文件版本、目标仓库路径、并发
  与预算默认值占位字段）。经 Schema 校验后供各模块读取。
- **DiagnosticReport**: `fleet doctor` 的输出实体：检查项列表，每项含
  名称、状态（ok / warning / error）、详情与修复建议；整体含就绪
  结论与退出码语义。
- **FleetEvent**: 结构化事件的接口定义（类型、时间戳、载荷），本阶段
  仅定义与可序列化，供 M11 持久化。
- **FleetError**: 统一错误模型：错误码、类别、上下文与用户可读信息。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 在全新环境从克隆仓库到质量门全绿（含依赖安装）不超过
  10 分钟。
- **SC-002**: `fleet doctor` 在健康环境下 5 秒内输出完整诊断报告。
- **SC-003**: 对五类故障注入（低版本运行时、git 缺失、非 git 目录、
  配置缺失、配置字段非法）的识别率为 100%，且每项都附带可执行的
  修复建议。
- **SC-004**: CodeGraph 与 Agent Runtime 全部不可用时，`fleet doctor`
  仍判定"环境就绪"（仅 warning）。
- **SC-005**: M1 的开发者不需要编写任何工程底座代码——配置、错误、
  日志、事件、ID、文件系统、git 检测全部可从 core 包直接引用。

## Assumptions

- 技术栈与工程结构遵循宪法 Architecture Constraints（TypeScript /
  Node 24 / pnpm workspace / tsup / Vitest / Zod / execa / yaml）；
  本 spec 只约束能力与验收，不重复实现细节。
- M0 交付时 apps/cli 与 packages/core 两个子包实际可用即可，其余
  packages 按各 Milestone 需要增量创建（符合宪法原则 VI 与 roadmap
  Rule 2 的精神）；最终目录结构以 roadmap §11 为目标形态。
- Agent Runtime availability 检查在本阶段仅探测本机已安装的
  Agent CLI 是否存在，不涉及接入（接入自 M7 起）。
- 主要开发环境为单机 macOS；CI 流水线可在 M0 后按需补齐，不阻塞
  验收。
- `.fleet/` 运行时目录（wiki / runs / worktrees 等）本阶段只需
  doctor 能识别与初始化空结构，不实现其中内容。
