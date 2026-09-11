# Research: M4 Core Domain

**Date**: 2026-09-11 | **Status**: 技术决策已定（spec 无 NEEDS
CLARIFICATION；此处解决 plan 层实现选型）

关键输入：M0 已落地的 config 加载模式（loader.ts：YAML → Zod
strictObject → FleetError + ConfigIssue[]，含 unrecognized_keys
展开）；core 错误模型（FleetError 的 code 是开放 string）。

## D1 — 包落位与依赖方向

- **Decision**: 独立包 `@fleet/mission`，依赖仅 `@fleet/core` +
  zod + yaml；core 与既有包零改动。
- **Rationale**: roadmap 最终结构既定（packages/mission）；M5
  Scheduler / M6 Runtime 是明确消费者，mission 实体是 Fleet
  Kernel 的公共词汇，不寄生于 repository 包。
- **Alternatives considered**: 实体放进 core（core 是"共享基础"，
  业务域实体会让 core 膨胀）；放进 repository（依赖方向错误——
  repository 是 Phase A 的仓库智能，不该被 Kernel 依赖）。

## D2 — 错误模型：mission 专属码 + core 载体复用

- **Decision**: mission 包内定义 `MISSION_FILE_MISSING /
  MISSION_FILE_UNREADABLE / MISSION_PARSE_FAILED /
  MISSION_INVALID` 错误码常量；抛 `FleetError`（category 取
  'config'——mission 文件是配置类输入），`context.issues` 复用
  core 的 `ConfigIssue`（path/expected/received/message 四字段，
  与 fleet.yaml 错误语义完全一致）。
- **Rationale**: core 的 ErrorCode 是 const 对象而非封闭枚举，
  FleetError.code 为开放 string——子包自有码零侵入；ConfigIssue
  结构已被 CLI 文本渲染与测试断言消费，复用即兼容。
- **Alternatives considered**: 扩展 core ErrorCodes（改共享包，
  违反包边界）；mission 自造 Issue 类型（与 config 错误割裂，
  CLI 要两套渲染）。

## D3 — 两层校验：Zod 结构层 + 语义层

- **Decision**: 校验分两层、一次报告：
  1. **结构层**（Zod strictObject 树）：字段类型/枚举/必填/未知
     字段拒绝/多文档 YAML 拒绝——Zod safeParse 的 issues 经
     toIssues（复刻 config loader 的转换，含 unrecognized_keys
     展开）转为 ConfigIssue；
  2. **语义层**（纯函数 `semantic.ts`）：跨字段/跨元素规则——
     task id 唯一、dependsOn 引用闭合、自环、execution 必备
     plan+非空 tasks、requirement id 唯一、mission/task id 命名
     规则。输入结构层通过后的 Mission，输出 ConfigIssue[]。
  最终 `validateMissionFile` 合并两层 issues 一次输出（FR-007
  不首错即停）。
- **Rationale**: 语义规则跨元素（重复 id 需看全列表），Zod
  superRefine 也能做但错误路径表达差且 schema 变丑；分层后
  M5 可单独复用 semantic.ts 在运行时二次校验（Runtime 产生的
  动态任务）。
- **Alternatives considered**: 全部塞 superRefine（路径质量差、
  不可复用）；只做结构层（放走重复 id/悬空依赖——SC-002 直接
  不达标）。

## D4 — Schema 形状要点（详见 data-model.md）

- **Decision**:
  - **Constraint 用 discriminatedUnion('kind')**：maxDurationMs /
    maxTokens 两个内建 kind，各自 value 为非负整数——未知 kind
    天然拒绝、参数按 kind 类型化（FR-006），后续加 kind 零破坏。
  - **plan 最小结构**：`{ summary: 非空, rationale?: string }`——
    plan 是"已确认方案"的锚（execution 必填），详细分解就是
    tasks 本身，不重复建模。
  - **tasks 顶层可选**：execution 必填非空（语义层查）、
    autonomous 可空（Reason 规划产生，M7 范围）。
  - **Artifact/Run 独立导出 schema**：本里程碑仅定义 + 单元
    校验，不进 mission 文件（FR-008）；字段设计对齐 M5/M6 的
    消费预告（roadmap M11 的 .fleet/runs/ 结构）。
  - **id 命名规则**：mission id 与 task id 均
    `/^[a-z0-9][a-z0-9-]*$/`（spec 建议 [a-z0-9-]，首字符限
    数字/小写字母防 `-x` 这类怪名）。
- **Rationale**: strictObject 全树（未知字段拒绝，FR-002）；
  enum planningMode 大小写敏感（YAML 值原样，`Execution` 报
  枚举错并列合法值——US2 场景 4）。
- **Alternatives considered**: Constraint 平铺 kind+value:
    unknown（失去类型化校验）；tasks 塞进 plan 内部（autonomous
    预填任务就无处安放）。

## D5 — CLI 与退出码

- **Decision**: `fleet mission validate <path> [--json]`；path
  必填（缺省值不做——用法层显式优于隐式，2 = 用法错误）。
  文本模式：通过 → 摘要（id/goal 首行/模式/任务数/验收数/
  约束数）；失败 → 逐条 `[字段路径] 期望 X，实际 Y：消息` +
  文件级错误单独一行。`--json` → `{ ok, summary? , issues? }`。
  事件 `mission.validated`（stderr，沿用 M0–M3 模式）。
- **Rationale**: 退出码 0/1/2 沿用全局契约（FR-001）；摘要让
  合法文件"校验即文档"。
- **Alternatives considered**: 默认扫 missions/ 目录批量校验
  （spec 明确 out of scope）；`fleet mission show`（roadmap 无
  此命令，推迟）。

## D6 — missions/demo.yaml 活样例

- **Decision**: 仓库根 `missions/` 落地一个合法 execution
  mission（demo：双任务 focus→reason 依赖链 + 两类约束 + 三段
  验收），提交进 git——它是文档、夹具、CI 冒烟三用（e2e 先
  断言它永远通过）。
- **Rationale**: spec FR-010 的目录约定需要实体；"永远合法"的
  样例防止 schema 演进时把格式契约悄悄改坏。
- **Alternatives considered**: 样例只放 specs 文档里（无法跑，
  会腐烂）。

## D7 — 测试策略

- **Decision**: 三层：
  1. **单元（packages/mission/src/*.test.ts）**：schema 结构
     矩阵（必填/类型/枚举/未知字段/多文档/非对象顶层）+
     semantic 规则矩阵（重复 id/悬空/自环/execution 缺 plan/
     空 tasks/requirement id 重复/id 命名）+ Artifact/Run
     schema 合法非法样例；纯函数，不触磁盘。
  2. **e2e（tests/cli/mission.test.ts）**：demo.yaml 通过 +
     摘要；10 类故障矩阵（SC-002/003 一次性报全）逐项断言
     退出码 1 + issues 字段路径；双跑一致（SC-004）；文件级
     故障（不存在/目录/非 UTF-8 二进制）不崩溃。
  3. **走查（quickstart）**：SC-005 错误自解释——仅凭输出
     修复每类故障。
- **Rationale**: 矩阵类验收只能自动化；SC-005 的"人能否看懂"
  必须走查。
- **Alternatives considered**: snapshot 测试全输出（格式微调
  即碎，逐字段断言更稳）。

## D8 — 与 M5 的接口预留

- **Decision**: 导出面刻意包含：全部实体 schema（M5 组装 DAG
  节点）、`semantic.ts` 的 `validateTaskGraph`（M5 运行时对新
  任务二次校验）、ConfigIssue 类型再导出。**不做**：拓扑排序、
  就绪选择、环检测（多节点）——M5 范围，提前实现只会被 M5 的
  真实需求推翻。
- **Rationale**: 边界纪律（宪法 Guardrails：可推迟的一律推迟）。
