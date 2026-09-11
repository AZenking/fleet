# Research: M9 Validation + Review Loop

**Date**: 2026-09-11 | **Status**: 技术决策已定

关键输入：M8 WorkspaceResolvingExecutor（生命周期 + auto 处置）、
M8 GitWorktreeManager（getDiff 含未跟踪文件语义）、M7
AgentTaskExecutor / RuntimeRegistry / 权限 env 强制、M5 批次屏障
调度（retry=1）、M0 execa 受控子进程模式（超时 + 输出截断）、
CliRuntimeAdapter stdout→output 捕获（64KB 截断）、FakeRuntimeAdapter
脚本化（按 taskId 出队 / 耗尽重复末项 / touchOnSuccess 写行为）。

## D1 — 包边界与 gate 接缝归属

- **Decision**: 新增 `packages/validation` 持有 Runner / Reviewer /
  循环编排；`@fleet/workspace` 只新增 `WorkspaceGate` 端口
  （`evaluate({task, workspace, execution, reexecute}) → GateDecision`），
  WorkspaceResolvingExecutor 在 inner 执行后调用 gate、按
  `decision.pass` 走既有 merge/destroy 处置。无 gate → M8 行为
  原样保留（向后兼容 + 逃生口 FR-010）。
- **Rationale**: 生命周期（worktree 创建/合并/销毁）与判定（验证/
  审阅/循环）职责分离；gate 需要 workspace 对象与 inner 重执行
  能力（修复轮次），端口放 workspace 使 validation 不必刺穿封装；
  端口由消费方实现——与 scheduler 持有 TaskExecutor 端口同一模式。
- **Alternatives considered**: ① gate 作为外层装饰器包装
  WorkspaceResolvingExecutor（需拿到内部 workspace 实体，刺穿
  封装）；② 循环放 scheduler（改调度核心，违反宪法 V 的最小
  侵入原则）；③ 循环放 runner.ts（编排层膨胀，库层不可单测）。

## D2 — 修复轮次与上限语义（maxReviewLoops 计数口径）

- **Decision**: `maxReviewLoops` = **修复轮次上限**（默认 2，首轮
  实现不计）。循环不变式：`rounds`（已消耗修复轮次）≥
  maxReviewLoops 时，任何"需要再修一次"的结论（validation fail
  或 changes_requested）立即收束为终态 `review_exceeded`
  （retryable=false）。故最大验证次数 = 最大审阅次数 =
  maxReviewLoops + 1。maxReviewLoops = 0 → 纯验证门（验证通过即
  验收，不执行 Wisdom；验证失败即 review_exceeded）。
- **Rationale**: roadmap 默认值 2 的直觉语义（"最多改两次"）；
  审阅次数 = 修复次数 + 1 保证每轮修复都被评价（不白修）；
  结构性不可能无限循环（上限检查先于修复发起）。
- **Alternatives considered**: 审阅次数计数（语义倒置——"最多看
  3 次"对用户无直觉）；validation fail 直接终态不给修复机会
  （与 changes_requested 路径不对称，浪费一轮可用预算——spec
  已钉死统一路径）。

## D3 — scheduler 的 retryable 信号（防上限翻倍）

- **Decision**: TaskExecutor 结果增加可选 `retryable?: boolean`
  （缺省 true）；`retryable === false` → 直接终态 failed（不重
  入队）。gate 的终态结论（review_exceeded / review_error）携带
  retryable=false；实现执行失败（首跑与修复跑的 runtime 失败）
  保持缺省可重试（M5 语义不变）。
- **Rationale**: M5 retry（默认 1）面向瞬时故障；审阅裁决是
  确定性结论——同一 worktree 同一 diff 重试不改判，重试只会把
  轮次预算翻倍（2 × (1+retry) 轮），击穿 SC-003 的"无第 3 轮"
  断言与宪法 III 上限精神。
- **Alternatives considered**: ① e2e 关 retry（RunnerOptions 不经
  CLI 暴露，fleet run 二进制路径做不到）；② gate 内吞掉重试
  （scheduler 仍会再次调用 execute——worktree 重建、全流程重跑，
  更贵且语义混乱）；③ 上限计数放 scheduler（判定逻辑泄漏进
  调度核心）。

## D4 — ValidationRunner 的检查执行模型

- **Decision**: diff 检查 = `manager.getDiff(workspace)`（M8 语义，
  含未跟踪文件；空 diff → 其余检查记 skipped（原因 empty-diff）、
  整体 noop）；lint / typecheck / tests = execa 受控子进程
  （cwd = workspace.path，默认超时 300s，mission
  `validation.timeoutMs` 可覆盖；超时 → status=timeout 按 fail 计，
  含已运行时长；非零退出 → fail 含 exitCode；正常退出 → pass）。
  每检查输出摘要 = 头 2KB + 尾 2KB（错误通常在尾部）+ 截断标注。
  顺序执行（diff → lint → typecheck → tests——lint 快失败省
  typecheck/tests 时间，确定性顺序利于事件重放断言）。
- **Rationale**: diff 先行确立变更面（空 diff 短路后续——基线上
  跑检查无意义）；复用 M8 的 diff 语义零重实现；顺序执行让
  "lint fail 后 tests 是否执行"确定化（执行——矩阵测试需要每项
  独立可断言，且 tests 独立证据价值高；不做 fail-fast 短路）。
- **Alternatives considered**: ① 四检查并行（输出交错、事件序
  不确定）；② fail-fast 短路（矩阵不完整，修复上下文缺证据）；
  ③ 自带 linter/test runner（违宪 VI——Fleet 验收仓库自身约定，
  不自带工具链）。

## D5 — ValidationProfile 解析链

- **Decision**: 每类命令三级解析：mission `validation.commands.*
  ` 显式配置（= 必选，命令失败即 fail）→ 目标 worktree 的
  package.json scripts 探测（`scripts.lint` / `scripts.typecheck` /
  `scripts.test` 存在 → `<pm> run <script>` / `<pm> test`）→ 无
  → skipped（结构化，不算失败）。包管理器探测：lockfile 识别
  （pnpm-lock.yaml → pnpm；yarn.lock → yarn；否则 npm）。diff
  检查不可配置（机制 = git worktree diff，非命令）。
- **Rationale**: 显式 > 探测 > 跳过的优先级让 e2e 与真实仓库各得
  其所（e2e 指向替身脚本，真实仓库零配置可用）；探测面向
  "命令存在性"不绑定包管理器（spec 假设）。
- **Alternatives considered**: ① 只允许显式配置（零配置不可用，
  违背"Fleet 独立执行"开箱语义）；② Fleet 自置检查命令表
  （硬编码工具链假设，违宪 VI）；③ 必选性独立字段（显式配置即
  必选的隐式规则更简单——少一个配置维度）。

## D6 — Wisdom 审阅执行与裁决解析

- **Decision**: `AgentReviewer` 经注入的 RuntimeAdapter（CLI 装配
  用 RuntimeRegistry.resolve('wisdom')）构造 RuntimeRequest：
  agentId = `agent:<taskId>-review`（Fake 脚本键 = `<taskId>-review`，
  与实现步骤天然分离）、cwd = 主仓根（READ_ONLY 角色 M8 语义）、
  env = wisdom + READ_ONLY（宪法 II 权限链路）、prompt = 确定性
 模板（Mission 摘要 + Artifact 摘要 + diff 摘录（头 8KB + 统计）+
  前轮意见）、timeoutMs 默认 120s 可配。裁决解析：`output` →
  JSON `{verdict, comments}`（宽松：也接受裸 `"approved"` /
  `"changes_requested"` 行）；解析失败或适配器失败 → 审阅错误
  （fail-closed，任务失败收束，不入修复循环——审阅者缺席不能
  放行也不能假装被拒）。
- **Rationale**: agentId 约定让单 Fake 实例可同时脚本化实现与
  审阅（CI 确定性）；fail-closed 是宪法 III 的保守侧——宁失败
  不假通过；JSON 优先 + 裸词宽容降低真实运行时的格式脆弱性。
- **Alternatives considered**: ① 审阅错误也消耗轮次（把"系统
  故障"与"内容不通过"混为一谈——重试改不了解析错误时白耗
  预算）；② Wisdom 专用 Adapter 子类型（违反宪法 IV 单一
  接缝）；③ prompt 自由拼接运行时输出（判定输入必须结构化）。

## D7 — 事件与报告面

- **Decision**: validation 包定义自有事件类型并经注入 emitter
  发射：`task.validation.started/completed`（含 loop、overall、
  checks 摘要）、`task.review.started/completed`（含 loop、
  verdict）、`task.review.exceeded`（含 maxReviewLoops、rounds）。
  CLI 把 gate emitter 接到既有 stderr FleetEvent 通道（type 命名
  空间合法）。RunReport 增 `reviews: ReviewPackage[]`（每 gated
  任务一份：终态、全轮次 Artifact + Verdict、diff 统计与引用、
  处置结论），经 ExecutorReportFace duck-typing 合成
  （WorkspaceResolvingExecutor 代理 gate.packages——同 M8
  dispositions 模式）。
- **Rationale**: 事件类型放 validation（自治域），不扩 runner 的
  MissionRunEvent 闭联合集（runner 不依赖 validation，避免环）；
  duck-typing 是 M8 已确立的报告合成模式，零接口侵入。
- **Alternatives considered**: ① 扩 MissionRunEvent 联合（runtime
  → validation 类型依赖成环）；② 事件走 RunReport 内嵌（事件
  的时序性丢失，M11 重放无原料）；③ ReviewPackage 全量内联
  diff（报告体积失控——引用 + 统计，spec 边缘用例已钉死）。

## D8 — mission schema 扩展与 CLI 开关

- **Decision**: missionSchema 增可选 `validation: { commands?: {
  lint?, typecheck?, tests? }, timeoutMs? }` 与 `maxReviewLoops?
  `（int ≥ 0，缺省 2 在运行时解析——schema 只校验形态）。CLI：
  `--no-validation-gate`（默认开；仅 worktree 模式生效——无隔离
  区即无 diff 可验证，--no-worktree 保持 M7 直通）；人类可读报告
  增验证/审阅行（每任务：轮次、终态、末轮结论）。
- **Rationale**: mission 是验收策略的正式契约（Codex Desktop
  确认面）；strictObject 加可选字段向后兼容；缺省值运行时解析
  让"宪法默认 2"单一来源在代码而非 schema。
- **Alternatives considered**: ① CLI 旗标承载策略（mission 文件
  外漂移，execution 模式语义破坏）；② constraint kind 扩展
  maxReviewLoops（约束系统是资源预算语义，验收策略不是资源）；
  ③ 独立 fleet.config（第二配置源，M12 前无消费方）。

## D9 — 测试替身矩阵

- **Decision**: 库级：双 Fake 实例（实现者 touchOnSuccess 写
  worktree；审阅者脚本化裁决——分离避免 touchOnSuccess 在审阅
  成功时污染主仓根）+ 真 GitWorktreeManager 于 tmp git 仓库。
  e2e：write-cli（M8 既有，写文件 + stdout 自报"tests passed"
  ——SC-001 的自报注入载体）+ review-approved-cli /
  review-reject-cli（stdout 印 JSON 裁决）+ tests/fixtures/checks/
  下 lint-pass/lint-fail/tests-fail/hang 脚本（mission 显式配置
  引用；hang 配小超时验 timeout 路径）。
- **Rationale**: SC-001 需要"自报与事实矛盾"的可注入载体——
  自报字符串出现在实现者 stdout（进 RuntimeResult.output）而
  真实检查失败，断言判定只取 Artifact；Fake 双实例避免共享
  touchOnSuccess 的越权写（审阅是 READ_ONLY）。
- **Alternatives considered**: 单 Fake 实例全脚本化（touchOnSuccess
  对 wisdom 成功步骤也写文件——主仓污染，违 SC-002/004 的零写入
  断言）；mock manager 全层（丢失真 git diff 语义—— noop / 二进
  制 / 未跟踪等边缘依赖 M8 真实行为）。
