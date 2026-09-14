# Research: CodeGraph 索引自动维护策略

**Date**: 2026-09-14 | **Status**: 技术决策已定

关键输入：investigate.ts 健康检查三分支（unavailable/uninitialized/
stale，M11 事件已全发）；cli-adapter.ts 只读红线注释（"init/sync
一律禁止——索引是 CodeGraph 的资产"）；core fleetConfigSchema
（version/repository/defaults）；doctor 的 configs/fleet.yaml 加载
模式；M11 emitEvent 通道。

## D1 — 写操作走独立 Maintainer（只读 adapter 不动）

- **Decision**: 新建 `CodeGraphMaintainer`（接口 + Cli 实现）；
  CodeGraphAdapter 契约与 cli-adapter.ts **零改动**——M1 红线
  （只读）对该文件继续逐字成立。维护 = opt-in 策略授权的独立
  写接缝。
- **Rationale**: 把"默认只读"与"显式授权的维护"物理隔离——
  红线不被悄悄稀释；未来审计一眼可辨写路径唯一入口。
- **Alternatives considered**: adapter 契约加 init/sync 方法
  （红线注释变成谎言，审查面恶化）。

## D2 — 策略注入而非配置自读

- **Decision**: `InvestigateOptions.codegraph?: { policy:
  'manual'|'sync'|'auto', timeoutMs?, maintainer? }`；调用方
  （CLI/MCP）读 configs/fleet.yaml 解析后传入；investigate 保持
  纯函数不读配置。缺省（无该 options）= manual。
- **Rationale**: investigate 可测性（Fake maintainer 直注）；
  CLI 与 MCP 同源解析；配置格式错误在调用方显式报错（沿用
  core config 校验语义）。
- **Alternatives considered**: investigate 内部读配置（隐式依赖
  + 测试需落盘夹具）。

## D3 — 单次维护状态机

- **Decision**: health 检查 → 命中可维护态（stale→sync；
  uninitialized+auto→init）→ 发 started 事件 → maintainer 执行
  （超时上限）→ completed/failed 事件 → **重查 health 一次** →
  fresh 则 codegraphUsable=true；否则按现状降级（fallback 记录
  含维护尝试）。**无循环**——重查后仍不新鲜直接降级。
- **Rationale**: spec FR-004 单次语义；确定性（同输入同输出）。
- **Alternatives considered**: 重试至新鲜（违 spec；不确定）。

## D4 — 维护事件与 fallback 记录

- **Decision**: 事件 codegraph.init.started/completed/failed ·
  codegraph.sync.started/completed/failed（payload：action/
  outcome/durationMs/policy）经既有 emitEvent；fallback 的
  detail 在维护尝试后附加"已尝试自动 <动作>：<结果>"；manual
  档 fixSuggestion 文案不变。
- **Rationale**: M11 观测面零新增通道；用户能从 logs 还原维护
  全过程。
- **Alternatives considered**: 只记 fallback 不发事件（观测面
  缺口——上一次刚修过同类问题）。

## D5 — 测试替身面

- **Decision**: FakeCodeGraphMaintainer（脚本队列：每次调用出队
  一个 {outcome: 'completed'|'failed'|'timeout', delayMs?}；调用
  记录可断言）；FakeCodeGraphAdapter 增 setHealth（维护成功后
  测试改写健康态，驱动"重查命中"路径）。真实 CLI 路径以 smoke
  手测（本机 codegraph 1.4.1）。
- **Rationale**: 三档 × 三态矩阵全确定性；不依赖真实索引。
- **Alternatives considered**: 真实 codegraph e2e（慢 + 索引
  副作用进测试环境）。

## D6 — 配置与旗标

- **Decision**: fleet.yaml `codegraph: { autoMaintain:
  manual|sync|auto, timeoutMs?: 正整数 }`（strictObject 缺省
  manual/300000）；CLI `--codegraph-maintain <档>` 一次性覆盖
  （旗标 > 配置 > 缺省）；MCP repo_investigate 读目标仓库配置
  同语义。
- **Rationale**: 配置归仓库 owner（团队一致）；旗标供临时排查。
- **Alternatives considered**: 仅旗标（每次调查都要带，摩擦大）。
