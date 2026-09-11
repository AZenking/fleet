# Research: M6 RuntimeAdapter + Fake Agents

**Date**: 2026-09-11 | **Status**: 技术决策已定

关键输入：M5 TaskExecutor 端口与批次屏障调度、M4 Run/TaskRun
schema 与 mission 校验、core 事件/ID 模式、宪法 IV（Fake 先行）。

## D1 — 包落位与编排归属

- **Decision**: `packages/runtime`（契约 + Fake + 桥接 + runner
  编排）；CLI 是薄壳。依赖方向：runtime → mission + scheduler +
  core（单向，后者零改动）。
- **Rationale**: 编排（校验→DAG→调度→报告）做成包内函数
  `runMissionFile` 才能不启进程做单元测试；CLI 只做渲染与退出码
  （对齐 doctor/repo/wiki/mission 命令模式）。
- **Alternatives considered**: 编排放 CLI（无法单元测编排矩阵）；
  桥接放 scheduler（调度器不该知道运行时请求形状——端口反向
  污染）。

## D2 — timeout / cancel 竞态：单次 settle 守卫 + 全量 clearTimeout

- **Decision**: Fake 每次执行创建一个 run 句柄
  `{ settled, timers[], cancelFn }` 入 inflight 表；`finish(result)`
  是唯一出口——`settled` 守卫保证单次 settle，**进入即
  clearTimeout 全部定时器**并从 inflight 删除。三路竞争：
  脚本延迟定时器（到达后按脚本 settle 成功/失败）、timeout
  定时器（settle timeout）、cancelFn（settle cancelled）——
  先到先得，后到者被守卫吞掉（迟到成功天然丢弃，FR-004）。
- **Rationale**: 这是真实运行时最难的语义（进程杀不干净 / 迟到
  结果污染 / 双重回调），先在 Fake 用最小机制合同化；clearTimeout
  全量 = process cleanup 的结构性保证（无悬挂句柄）。
- **Alternatives considered**: AbortController 传播（M6 无真实
  子进程，引入即过度设计；M7 真实 Adapter 再用）。

## D3 — 角色延迟画像与脚本化

- **Decision**: 默认画像（产品语义 reflex 快 → wisdom 慢）：
  `reflex 15ms / focus 30ms / reason 45ms / insight 30ms /
  wisdom 60ms`；`zeroDelays: true` 整体置零（CI 快跑）。脚本化：
  `script: Record<taskId, FakeStep[]>`（按调用序出队、耗尽重复
  末项，对齐 M5 ScriptedExecutor 心智）；FakeStep =
  `{ outcome: 'success' | 'failure' | 'error' | 'hang',
  delayMs?, output? }`——**'hang' = 永不自行完成**（timeout /
  cancel 测试的必需形态）；'error' = 抛异常（契约：execute 不
  让异常逃逸——Fake 内部 catch 转 error 失败码……不，契约要求
  实现方不逃逸异常，Fake 的 'error' 路径模拟"实现内部捕获后
  返回 error 码"——两者在结果层等价）。
- **Rationale**: 画像毫秒数小到 e2e 秒级完成、大到可测并发
  重叠；hang 是 timeout 诚实性的唯一可注入形态。
- **Alternatives considered**: 画像按 prompt 长度（伪相关）；
  脚本按 agentId 键（与 M5 taskId 心智不一致）。

## D4 — timeoutMs 预算推导：任务级透传

- **Decision**: 优先级：task.constraints 的 maxDurationMs >
  mission.constraints 的 maxDurationMs > 默认 5000ms。**整段
  透传**给该任务的每次执行（不做任务间均分）。报告记录
  `perTaskTimeoutMs`（推导依据可追溯）。
- **Rationale**: 均分会让单任务预算随任务数缩水且依赖调度顺序
  （不确定）；透传语义直白："每个任务的执行不得超过此预算"；
  总时长控制是 maxDurationMs 的 mission 级语义，归 M10 预算
  层与 M11 恢复层。
- **Alternatives considered**: 剩余预算均分（动态预算 = M10
  范围，提前实现会被推翻）。

## D5 — 桥接规则（集中一处）

- **Decision**: `MissionRuntimeBridge implements TaskExecutor`：
  - runId：`run_<uuid>` 每次派发生成（core newRunId 风格——
    `run_` + randomUUID 短式），同任务重试是新 runId（运行时
    语义：每次执行是独立 run）
  - agentId：`agent:<taskId>`（M6 Fake 语义；真实 agent 实例
    管理属 M7）
  - prompt：`[任务 ${taskId}] ${task.goal}`（确定性模板；
    Context Builder 属 M10）
  - cwd：桥接配置传入（目标仓库根）
  - env：可选透传（M6 不设置）
  - 附带记录：每任务每次执行的 startedAt/endedAt 时间戳
    （TaskRun 合成原料）+ 生成过的全部 RuntimeRequest（测试
    断言请求字段齐备的载体）
- **Rationale**: FR-007 集中规则；记录请求流让桥接可测试（US3
  场景 3）。
- **Alternatives considered**: agentId 直接用 taskId（缺前缀，
  M7 引入 agent 实例时要改语义）。

## D6 — RunReport 合成

- **Decision**: `RunReport = { run: Run(M4), outcome:
  RunOutcome(M5), runtime: { adapter: 'fake', perTaskTimeoutMs:
  Record<taskId, ms> } }`。Run.taskRuns 从桥接时间戳 + M5 终态
  合成（status 用 M5 终态；startedAt/endedAt 取该任务**最后一次**
  执行的时间戳——与 attempts 终值一致）。runSchema.parse 自校验
  （SC-006 内建）。
- **Rationale**: M4 schema 是唯一权威形态——报告构造后立刻
  parse，schema 漂移当场暴露。
- **Alternatives considered**: 直接输出 M5 outcome（丢 Run 形态，
  M11 持久化返工）。

## D7 — 事件三枚

- **Decision**: `mission.run.started`（runId/missionId，编排
  开始）→ 任务执行（无 task 级事件——M11 全量）→
  `mission.run.completed | mission.run.failed`（runId/status/
  任务计数/耗时）。stderr debug 通道（对齐 M0–M5 模式），
  --json stdout 纯净。
- **Rationale**: FR-009 顺序保证由编排函数单线程发出结构性
  成立；task 级事件面留给 M11 的事件全集（避免现在定错字段）。

## D8 — autonomous 无任务的处置

- **Decision**: 校验通过 + tasks 空/缺 → 不进调度，返回
  `{ status: 'completed', note: 'autonomous mission 无任务——
  Reason 规划属 M7，本次无可执行内容' }`，退出码 0，事件发
  completed（带 note）。
- **Rationale**: spec US1 场景 4 的直接落地——显式衔接 M7 而
  非静默或失败。

## D9 — 测试策略

- **Decision**: 三层：
  1. **fake.ts 单元**（必测六项主战场）：timeout 诚实（hang +
     timeoutMs → timeout 且延迟到点后无第二结果）；cancel
     即时（hang + cancel → cancelled 毫秒级，其他执行不受
     影响）；timeout/cancel 竞争单次 settle；failure/error
     结构化；cleanup（任意路径后 inflight 空、无悬挂——用
     `vi.useFakeTimers` 推进验证 clearTimeout 全量 + 真实
     短延迟子样）；画像序（reflex < wisdom）与零延迟模式。
  2. **bridge/runner 单元**：请求字段断言（runId 前缀/agentId/
     prompt/cwd/timeoutMs 推导优先级）；demo mission（内存
     FS）端到端 completed；必败 mission 的 attempts=2 + 传播；
     autonomous note；非法 mission 校验前置（不执行任何请求）。
  3. **e2e**（tests/cli/run.test.ts）：`fleet run
     missions/demo.yaml` → 0 + completed + 事件 + 报告过
     runSchema；tmp 必败 mission → 1 + skipped；autonomous →
     0 + note；**进程干净退出**（execa 默认无 forceExit 即证
     无悬挂计时器）；--json 与文本双模式。
- **Rationale**: roadmap 必测六项（FR-011）全部落自动化；e2e
  以 Fake 为准（宪法 IV）。
- **Alternatives considered**: fake timers 全覆盖（真实并发 /
  干净退出断言失真——混合使用）。

## D10 — CLI 退出码与渲染

- **Decision**: `fleet run <path> [--json]`：0 = completed（含
  autonomous note）/ 1 = mission failed、文件或校验错误 / 2 =
  用法错误。文本渲染：终态行 + 任务表（id/角色/状态/次数/
  耗时）+ 传播链 + 事件提示；--json 输出 RunReport（含
  runSchema.parse 通过的 Run）。
- **Rationale**: 全局退出码契约延续；任务表让 demo 一眼可读
  （验收演示形态）。
