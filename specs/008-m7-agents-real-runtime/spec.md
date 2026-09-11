# Feature Specification: M7 五角色 Agent + 真实 Runtime（认知角色落地与权限强制）

**Feature Branch**: `008-m7-agents-real-runtime`

**Created**: 2026-09-11

**Status**: Draft

**Input**: User description: "下一个任务" — 对应
`agent-fleet-roadmap.md` Phase C / M7：实现 Reflex / Focus /
Reason / Insight / Wisdom 五个 Agent 角色定义，接入真实
RuntimeAdapter（Codex / Gemini / Pi），权限在 Runtime / Tool
Policy 层强制。验收锚点：**同一 Agent Role 可替换 Runtime 而无需
修改 Scheduler / Core**。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 五角色定义与运行时注册 (Priority: P1)

作为 Fleet 架构的消费者，mission 里的每个 task 声明
`agentRole`，运行时通过**角色注册表**解析到具体 Agent：每个
角色有明确定义——系统提示片段（角色职责）、权限级别
（Reflex 轻写 / Reason 唯一深写 / Focus·Insight·Wisdom 只读，
宪法 II）、输出形态提示（结构化产物雏形）。**把某个角色从
Fake 换成 Codex（或反之）只改注册配置，Scheduler / Core /
mission 文件零改动**——这就是本里程碑的验收锚点。

**Why this priority**: 角色×运行时的解耦矩阵是 Fleet 的架构
脊柱（宪法 IV）；M6 的桥接已经把"任务→请求"集中一处，现在
把"角色→运行时"的选择也收敛到注册表，替换才是配置行为而非
代码行为。

**Independent Test**: 同一 mission 分别用 `{ reason: fake }` 与
`{ reason: codex }` 两种注册运行——Scheduler / bridge 代码零
改动，请求差异只来自注册表（自动化：注册表驱动 + 断言两种
运行都完成调度语义）。

**Acceptance Scenarios**:

1. **Given** 五个角色各至少一个任务的 mission，**When** 以
   Fake 注册运行，**Then** 每个角色的请求都携带该角色的
   权限声明与提示片段，全部按 M5/M6 语义完成。
2. **Given** 把 reason 角色的注册从 Fake 换成任一其他适配器
   （注入的测试替身亦可），**When** 重新运行同一 mission，
   **Then** Scheduler / bridge / mission 文件零改动，行为差异
   仅来自新适配器。
3. **Given** 未注册的角色 / 空注册表，**When** 运行，**Then**
   明确错误（哪个角色缺注册），不静默回退。
4. **Given** 角色定义，**When** 查阅，**Then** 五角色的权限
   矩阵与宪法 II 一致并可从代码 / 配置直接读到（不是只写
   在文档里）。

---

### User Story 2 - 真实 RuntimeAdapter（Codex / Gemini / Pi） (Priority: P2)

作为 Fleet 使用者，我本机装了哪些 Agent CLI（codex / gemini /
pi），Fleet 就能把对应角色接到真实运行时：适配器探测 CLI
可用性（doctor 同源语义）；执行 = 子进程调用（prompt 传入、
输出捕获、exit code 判成败）；**timeout = kill 进程**、
**cancel = kill 进程**（M6 契约四条款在真实进程上的落地）；
未安装的运行时明确报"未安装 + 安装建议"，e2e 在未安装机器上
自动跳过（codegraph 同模式）。

**Why this priority**: Fake 验证的是编排正确性，真实子进程验证
的是契约可行性（kill 语义、输出捕获、退出码）——宪法 IV 要求
Fake 先行（M6 已交付），真实适配器是 Phase C 的第一块拼图。

**Independent Test**: 装有任一 CLI 的机器上 `fleet run --runtime
<name>`（或按角色注册）跑 demo mission；未安装的机器上对应
e2e 标记跳过、单元层用受控 PATH + echo 替身脚本驱动全矩阵。

**Acceptance Scenarios**:

1. **Given** 本机安装 codex CLI，**When** 注册 reason→codex 并
   运行，**Then** 子进程被真实调用（prompt 传入），输出捕获进
   结果，正常退出 → 任务成功。
2. **Given** 某任务执行超预算，**When** 运行，**Then** 子进程
   被 kill，结果为 timeout 失败（进程不残留——M6 契约条款 2/4
   的真实进程版）。
3. **Given** CLI 非零退出 / 输出异常，**When** 执行结束，
   **Then** 结构化失败（exit code + stderr 摘要），不崩溃。
4. **Given** 未安装的运行时，**When** 探测 / 使用，**Then**
   明确"未安装 + 建议"，绝不静默假装执行。
5. **Given** cancel(runId)（进程在途），**When** 调用，**Then**
   进程组被终止、结果 cancelled、无孤儿进程（cleanup 的进程
   版断言）。

---

### User Story 3 - 权限由 Runtime / Tool Policy 强制 (Priority: P3)

作为 Fleet 的合规消费者，权限矩阵不是文档约定而是**系统强制**：
角色→权限映射（READ ONLY / 轻写 / 深写）在 Tool Policy 层
集中定义；每个发给真实运行时的请求**必须**携带权限声明，并
由适配器翻译为该运行时的能力约束（如只读沙箱 / 禁写参数 /
提示词权限段——按各 CLI 实际能力择最大可执行项）；只读角色
的请求不得包含写授权。物理工作区隔离（Git Worktree）是 M8
的地基，本里程碑把"权限必达运行时"钉死。

**Why this priority**: 宪法 II 红线——"仅靠 Prompt 约束视为
违规"。M7 必须证明权限是请求级强制（缺声明 = 拒绝派发），
M8 再补物理隔离；顺序反了就会出现"声明了但没人执行"的空窗。

**Independent Test**: 断言注入的请求流——只读角色（focus/
insight/wisdom）的请求权限为 READ ONLY 且不含写授权参数；
reason 的请求为 DEEP_WRITE；reflex 为 LIGHT_WRITE；绕过
Tool Policy 构造的裸请求被适配器拒绝。

**Acceptance Scenarios**:

1. **Given** 任一角色的任务派发，**When** 请求发出，**Then**
   请求携带权限声明（permission 字段 + 运行时特定约束参数），
   与宪法 II 矩阵一致。
2. **Given** focus / insight / wisdom 角色的请求，**When**
   适配器翻译为运行时约束，**Then** 只读能力（无写授权路径）。
3. **Given** 未经 Tool Policy 的裸请求（无权限声明），**When**
   适配器执行，**Then** 拒绝执行并明确报错（强制层不可绕过）。
4. **Given** 权限矩阵的任何消费方（注册表 / 适配器 / 报告），
   **When** 引用权限，**Then** 单一来源（Tool Policy 模块），
   不存在第二份手写映射。

---

### Edge Cases

- 多角色同运行时（全部接 codex）：正常——注册表是 role→runtime
  映射，允许多对一。
- 同 CLI 不同角色的提示差异：提示片段按角色注入（同一运行时
  不同人格）。
- CLI 输出超大：截断策略（上限 + 截断标注），不爆内存。
- CLI 要求交互（等待 stdin）：以无 stdin 方式调用（M6 的
  stdin: ignore 语义），交互即超时路径。
- 探测通过但执行期崩溃（CLI 升级 / PATH 变化）：执行失败语义
  （error 码），不连带击穿其他任务。
- Fake 与真实适配器混注册（reason→codex、其余→fake）：合法
  且是推荐的渐进采用路径。
- 真实运行时不可用时的 fleet run：按注册表显式报错退出（不
  自动降级 Fake——静默换运行时违背可预期性；用户显式选 Fake）。
- cancel 的进程组终止：子进程派生孙进程时按进程组 kill
  （detached + 负 PID 语义），防孤儿。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 五个 Agent 角色 MUST 各有定义（职责提示片段、
  权限级别、输出形态提示），集中于 agents 模块；权限矩阵
  MUST 与宪法 II 一致（reflex=LIGHT_WRITE / focus=READ_ONLY /
  reason=DEEP_WRITE / insight=READ_ONLY / wisdom=READ_ONLY）。
- **FR-002**: 运行时注册表 MUST 提供 role→RuntimeAdapter 解析；
  替换某角色的运行时 MUST NOT 要求修改 Scheduler / bridge /
  mission 文件（验收锚点）；未注册角色 MUST 明确报错，无静默
  回退。
- **FR-003**: CodexAdapter / GeminiAdapter / PiAdapter MUST 实现
  M6 RuntimeAdapter 契约（execute + cancel + 四条款：异常不
  逃逸 / timeout 诚实 / cancel 单次 / 清理完备——真实进程版：
  kill 即清理，无孤儿进程）。
- **FR-004**: 真实适配器执行 MUST 为子进程调用：prompt 传入、
  stdout/stderr 捕获、exit code 判成败；超预算 MUST kill 进程
  并以 timeout 失败；输出 MUST 有截断上限。
- **FR-005**: CLI 可用性 MUST 可探测（doctor 同源语义：命令
  存在 + 版本可达）；未安装的运行时 MUST 报"未安装 + 安装
  建议"，MUST NOT 静默假装执行。
- **FR-006**: Tool Policy MUST 为权限单一来源：请求构造 MUST
  经过策略层注入权限声明；裸请求（无权限）MUST 被适配器拒绝
  执行；只读角色的运行时约束 MUST 不含写授权。
- **FR-007**: `fleet run` MUST 支持运行时选择：按角色的注册
  配置（CLI 选项 / 配置文件），缺省全 Fake；显式选择不可用的
  真实运行时 MUST 报错而非静默降级。
- **FR-008**: e2e MUST 以 Fake 为基线（宪法 IV 确定性）；真实
  适配器的 e2e 在对应 CLI 缺失的机器上 MUST 自动跳过；单元层
  用受控 PATH + 替身脚本驱动真实适配器全矩阵（超时 kill /
  cancel / 非零退出 / 输出截断 / 裸请求拒绝）。
- **FR-009**: 角色提示片段与权限声明 MUST 随请求可观测（请求
  流记录），报告 / 日志可追溯"这个任务以什么权限跑了什么
  运行时"。
- **FR-010**: 物理工作区隔离（Git Worktree、写入范围限制）
  属 M8——本里程碑的权限强制到"请求级必达 + 适配器翻译"，
  不得宣称物理隔离已成立。

### Key Entities

- **AgentDefinition**: role、职责提示片段、permission
  （READ_ONLY / LIGHT_WRITE / DEEP_WRITE）、输出形态提示。
- **RuntimeRegistry**: role→RuntimeAdapter 映射 + 解析（未注册
  报错）；多对一合法；构建自配置（CLI 选项 / 配置文件）。
- **ToolPolicy**: 权限单一来源——矩阵常量 + 请求注入（把
  permission 翻译为运行时无关的声明 + 适配器侧的运行时特定
  约束参数）。
- **CliRuntimeAdapter 基座**: 三个真实适配器的共享实现——探测、
  子进程执行（prompt 传参 / 输出捕获 / 截断）、kill 语义
  （timeout/cancel → 进程组终止）、无 stdin。
- **RuntimeAvailability**: 运行时名、available、版本、建议。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 同一 mission 在 { 全 Fake } 与 { reason→替身
  适配器 } 两种注册下运行——Scheduler / bridge / mission 零
  改动，两种均完成调度语义（替换自由度，验收锚点操作化）。
- **SC-002**: 权限矩阵断言：五角色的请求权限与宪法 II 一致
  100%；只读角色请求不含写授权 100%；裸请求被拒绝 100%。
- **SC-003**: 替身脚本驱动的适配器矩阵（成功 / 非零退出 /
  超时 kill / cancel kill / 输出截断 / 探测不可用）全部
  自动化，0 例进程残留（kill 后无孤儿——进程组断言）。
- **SC-004**: 装有对应 CLI 的机器上，真实 e2e（codex /
  gemini / pi 至少其一）端到端跑通 demo mission；未安装机器
  自动跳过且套件仍绿。
- **SC-005**: `fleet run` 的运行时选择显式生效：注册配置/
  选项 → 请求流可追溯（role → runtime → permission）。
- **SC-006**: M6 契约四条款在真实适配器上 100% 复测通过
  （异常 / timeout 诚实 / cancel 单次 / 清理）。

## Assumptions

- codex / gemini / pi 以 CLI 形态接入（execa 子进程，与
  codegraph 同模式）；各 CLI 的具体参数（沙箱 / 只读开关 /
  提示词传递方式）由 plan/research 按实测探测决定，spec 只
  约束"权限必达 + 能力约束择最大可执行项"。
- 物理隔离（Worktree）与写入范围强制属 M8（FR-010 显式划界）；
  M7 的 WRITE 权限是声明 + 运行时约束，不是文件系统担保。
- Agent 间结构化产物（Artifact 全链路）以"输出形态提示 +
  输出捕获"最小形态存在，完整 Artifact 管道属后续（M9 验证
  取证消费 / M11 持久化）。
- e2e 基线仍是 Fake（宪法 IV）；真实 CLI e2e 依赖本机安装，
  缺失即跳过——确定性由单元层替身脚本保证。
- 运行时注册配置面：CLI 选项优先 + 配置文件（configs/agents/
  的完整形态属 M12 Control Center 范畴，M7 最小可用）。
- 零新增第三方依赖（子进程 / 探测复用 execa 与 core probe）。
