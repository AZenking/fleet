# Research: M10 Context Builder + Token Budget

**Date**: 2026-09-11 | **Status**: 技术决策已定

关键输入：M7 AgentTaskExecutor（手写 prompt 模板 + requests 记录）、
M9 AgentReviewer（自拼审阅 prompt）与 ValidationArtifact、M4
maxTokens 约束（mission/task 两级已建模）、M5 retryable 终态信号、
M8/M9 的 RunReport duck-typing 合成模式、FakeRuntimeAdapter 脚本化
注入模式、替身 CLI 的 `[任务 <id>]` prompt 解析约定。

## D1 — 两包边界与依赖方向

- **Decision**: `@fleet/context`（装配/压缩/渲染/优化统计）与
  `@fleet/budget`（估算口径/usage 记录/三级聚合）分立；context
  → budget 单向依赖（section 尺寸用 budget.estimate 的口径函数，
  全链一致）。
- **Rationale**: roadmap 终局结构两包并列；口径单一来源防"装配
  尺寸 ≠ 报告尺寸"漂移；单向依赖无环。
- **Alternatives considered**: 合一包（终局结构对齐失败）；口径
  放 context（budget 聚合复算时反向依赖）。

## D2 — 上游产物载体：RunArtifactRegistry（内存）

- **Decision**: executor 执行后把 RuntimeResult.output（+ 关联
  taskId/role）登记进 run 级 registry；ContextBuilder 按
  task.dependsOn 解析直接上游产物，按 section 规则映射（focus
  输出 → findings、insight 输出 → evidence）。M9 的
  ValidationArtifact / diff 经注入的 suppliers 进入 wisdom/insight
  规则（不强registry——它们在 gate 手里）。
- **Rationale**: 最小可行——不引入持久化（M11）与即时调查
  （Repository Intelligence 的调用是任务执行的事，不是装配的事）；
  registry 是纯内存 Map，e2e 确定性。
- **Alternatives considered**: 复用 M4 artifactSchema 落盘（持久
  化属 M11）；装配时即时调用 repository 包（把加速器变成装配
  硬依赖，违宪 I/VI）。

## D3 — 角色规则表（声明式，类型层排除全量）

- **Decision**: `ROLE_CONTEXT_RULES: Record<AgentRole,
  SectionSpec[]>`——SectionSpec = { kind, priority, source:
  resolver }。SECTION_KINDS 闭集（mission/taskGoal/findings/
  evidence/source/constraints/diff/validation/feedback/config）；
  resolver 只能从 registry/suppliers/task/mission 取数——
  "Full Conversation / Full Repository / All Artifacts" 无对应
  resolver，结构性排除（SC-002 的编译期 + 运行时断言面）。
- **Rationale**: 规则表 = 单一事实源（新角色/调规则只改表）；
  类型闭集让"未知 section"不可能进包。
- **Alternatives considered**: 每角色自由拼装函数（无声明式
  审计面）；prompt 级约定（运行时无法断言构成）。

## D4 — 渲染兼容：`[任务 <id>]` 标记保留

- **Decision**: render(package) 产确定性文本：首行
  `[${role} · ${permission}]`、次行 `[任务 ${task.id}] ${goal}`、
  之后每 section `## <kind>
<content>`；feedback section 注入
  `[修复反馈]` 行（M9 语义保留）。替身 CLI 的 `[任务 X]` 解析
  逐字节兼容（M8/M9 e2e 不动）。
- **Rationale**: prompt 是 RuntimeRequest 的既有契约面；M10 改
  构成不改协议。
- **Alternatives considered**: 结构化 prompt 字段（RuntimeRequest
  破坏性扩展——波及全部适配器，无必要）。

## D5 — 估算口径与单价

- **Decision**: `estimateTokens(text) = ceil(chars /
  CHARS_PER_TOKEN)`（缺省 4，构造可配）；estimatedCost =
  Σ(tokens × 单价表[role?]，缺省全 0——只计数不计价，单价属
  使用侧配置)。durationMs 实测；contextSize = 装配产物 token 估算。
- **Rationale**: 零依赖（不引入 tokenizer，宪 VI）；口径函数
  单一来源可复算（SC 复算断言用同一函数）。
- **Alternatives considered**: 真实 tokenizer（新依赖）；字符数
  直报（与 maxTokens 约束单位不一致）。

## D6 — usage 通道与卫生

- **Decision**: RuntimeResult 增可选 `usage?: { inputTokens,
  outputTokens, cachedTokens }`（三者 ≥0 int）。Fake：FakeStep 增
  `usage?`（脚本确定性注入）；CLI 适配器：尽力解析（输出含
  `FLEET_USAGE {...}` JSON 行才采纳，否则缺省 unmeasured）。
  Ledger 卫生：负数/NaN/非整数 → 丢弃该字段并标注 invalid；缺
  usage → measured=false 全 0。
- **Rationale**: 测量尽力而为（spec FR-006）；Fake 先行保 CI
  确定性（宪 IV）；标记行协议避免误解析任意输出。
- **Alternatives considered**: usage 必填（真实 CLI 大多不报告，
  逼伪造）；正则扫描任意数字（误报率高）。

## D7 — 压缩阶梯与 Reject 语义

- **Decision**: build 时 totalTokens > budget（task 级
  maxTokens ?? mission 级，都无则不强制）→ 压缩轮（最多 2）：
  按 priority 升序截 section（保留头尾各 ~25% + truncation
  marker，最低优先级先截）→ 复检；轮次耗尽仍超 → 返回
  BudgetRejection（executor 转任务失败 retryable=false——M9
  信号复用）。压缩确定性：同输入同输出。
- **Rationale**: roadmap 阶梯的规则化落地（零 LLM，宪 V）；
  retryable=false 复用 M9 语义（确定性结论不重试）。
- **Alternatives considered**: LLM 摘要（1.0 后）；压缩无限轮
  （不确定）。

## D8 — M9 审阅上下文迁移

- **Decision**: AgentReviewer 改用 ContextBuilder（wisdom 规则：
  mission 摘要 + validation artifact 摘要 + 上游 findings +
  diff 摘录 + feedback/priorFeedback section + 裁决格式说明行）；
  渲染保留 M9 prompt 的关键锚（"changes_requested" 格式说明、
  前轮意见、失败检查摘要——M9 review.test 的断言面）。
- **Rationale**: FR-004（统一装配）+ SC-006（零回退）；锚保留
  让 M9 e2e 不动。
- **Alternatives considered**: 审阅继续自拼（双事实源漂移）。

## D9 — 报告面与聚合算术

- **Decision**: BudgetLedger：`record(execution)` → 按 taskId
  聚合（executions[] + sums）→ mission 聚合（tasks[] + sums +
  optimizations 汇总）；RunReport.budget = ledger.snapshot()
  （runner duck-typing，executor 暴露 `budget` getter——同
  dispositions/reviews 模式）。修复轮次的多次执行同 taskId 累计。
- **Rationale**: 三级视图一次 snapshot；duck-typing 零接口侵入
  （三连模式）。
- **Alternatives considered**: ledger 独立注入 RunnerOptions
  （CLI 装配面 +1，收益低）。
