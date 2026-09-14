# Feature Specification: CodeGraph 索引自动维护策略（stale→sync / uninitialized→init）

**Feature Branch**: `014-codegraph-autosync-policy`

**Created**: 2026-09-14

**Status**: Draft

**Input**: User description: "可否增加一个策略如果落后就 codegraph
sync；如果没有初始化就 codegraph init"。现状（M2 决策）：索引
uninitialized / stale 时 Fleet 只降级到原生搜索并在结果中给出
fixSuggestion（"可运行 codegraph init/sync——Fleet 不会代为执行"），
用户需手动维护索引。本特性把"是否代为执行"做成**可配置策略**：
仓库可在 fleet.yaml 声明让 Fleet 在调查入口自动执行一次索引
维护（stale → sync；uninitialized → init），维护后重查健康度，
能用加速器就用；维护失败或不适用时降级语义**与现状完全一致**
（宪法 I：调查永不因加速器问题失败）。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 索引自动维护策略 (Priority: P1)

作为仓库 owner，我在 fleet.yaml 声明 CodeGraph 维护策略后，
Fleet 在每次调查的 CodeGraph 健康检查处按策略行事：

- **manual（默认 = 现状）**：不做任何维护，只降级 + 给建议
  ——所有未配置的仓库零行为变化；
- **sync**：索引**存在但过期**（stale）→ Fleet 自动执行一次
  `codegraph sync` → 重查健康度 → 新鲜则本次调查命中 CodeGraph
  加速；未建索引（uninitialized）仍只建议（首次建索引属
  **auto** 档范围）；
- **auto**：在 sync 档基础上，**未建索引**时自动执行一次
  `codegraph init`（首次建索引可能分钟级，故单列一档）。

策略可被单次调用旗标覆盖（如临时排查用 manual 语义）。

**Why this priority**: 这是特性的主体——把现有"只建议"升级为
"可选代执行"，直接消除用户手动 sync 的摩擦；默认 manual 保证
向后兼容。

**Independent Test**: 三档策略矩阵（注入式假 CodeGraph CLI）：
manual 下 stale 仓库零维护调用、走降级；sync 下 stale 仓库恰
一次 sync 调用、维护后命中 codegraph 路径；auto 下未建索引仓库
恰一次 init 调用、建成后命中。

**Acceptance Scenarios**:

1. **Given** 策略 = sync 且索引 stale，**When** 调查执行，
   **Then** Fleet 执行一次 sync → 重查 → 新鲜 → 走 CodeGraph
   路径（pathsUsed 含 codegraph），fallback 无 stale 记录。
2. **Given** 策略 = sync 且索引 uninitialized，**When** 调查
   执行，**Then** 不执行 init（越档），fallback 记录
   uninitialized + fixSuggestion 提示需 auto 档。
3. **Given** 策略 = auto 且未建索引，**When** 调查执行，
   **Then** 执行一次 init → 重查 → 建成 → 命中 CodeGraph。
4. **Given** 策略 = manual（或缺省），**When** 任何状态，
   **Then** 行为与当前版本逐字节一致（零维护调用，只降级 +
   建议）。
5. **Given** 单次旗标覆盖（如 --codegraph-maintain=manual），
   **When** 调查执行，**Then** 以旗标为准（覆盖 fleet.yaml）。
6. **Given** CodeGraph CLI 不可用（unavailable），**When**
   任何策略，**Then** 零维护调用（sync 无从执行），降级如常。

---

### User Story 2 - 安全边界与降级保障 (Priority: P2)

作为 Fleet 的保守性保障，自动维护被严格圈禁：**单次语义**
（一次调查至多一次维护动作，禁止循环重试——sync 后仍 stale
就直接降级）；**超时上限**（维护子进程超时按失败处理，默认
300s 可配）；**失败降级**（维护失败/超时 → 与现状完全相同的
降级链，调查照常完成，fallback 记录中含"已尝试维护"信息）；
**事件可观测**（codegraph.init.sync 等维护动作全程落事件流，
M11 观测面可见）。

**Why this priority**: 自动执行外部写操作（索引是磁盘产物）
必须把爆炸半径圈死——宪法 I 的"加速器只影响速度/成本、不影响
可用性"在维护路径上同样必须成立。

**Independent Test**: 故障注入矩阵——维护命令失败 / 超时 /
维护成功但索引仍 stale：三态全部降级完成调查（结果正确）、
零崩溃、事件与 fallback 记录完整。

**Acceptance Scenarios**:

1. **Given** 策略 = sync 且 sync 命令非零退出，**When** 调查
   执行，**Then** 降级到搜索路径，调查成功完成，fallback
   detail 含"已尝试自动 sync 失败"。
2. **Given** 维护子进程超过超时上限，**When** 超时发生，
   **Then** 终止子进程、按失败降级，调查不悬挂。
3. **Given** sync 成功但重查仍 stale（如期间源码又变更），
   **When** 处理，**Then** 直接降级，**不发起第二次 sync**
   （事件计数恰 1 次维护动作）。
4. **Given** 维护执行，**When** started/completed/failed 各
   时点，**Then** codegraph.init.* / codegraph.sync.* 事件
   落盘（M11 事件流），含动作、结果、耗时。
5. **Given** 任何维护失败，**When** 调查结束，**Then** 调查
   结论的正确性与无维护时一致（加速器问题的最大代价 =
   慢 + Token 多，宪法 I 语义保持）。

---

### Edge Cases

- fleet.yaml 缺失 / 无该字段 → 默认 manual（现状语义）。
- 策略值非法 → 配置校验报错（沿用 strictObject 拒绝未知值）。
- unavailable（CLI 未安装）→ 任何策略零维护调用。
- init 半途失败（索引损坏）→ 重查仍 uninitialized → 降级，
  fallback 记录 init 失败；不重试。
- 并发调查同时触发维护 → Fleet 不加分布式锁（记录在案），
  依赖 codegraph 自身索引写安全；CI 高并发场景建议预热或
  用 manual 档。
- 维护期间用户 Ctrl-C → 子进程随进程组终止（沿用受控子进程
  语义）。
- wiki 侧 stale（wiki_stale）不在本特性范围（wiki 更新是
  LLM 生成，语义完全不同）。
- MCP repo_investigate 路径同样生效（策略经配置读取，与 CLI
  同源）。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: fleet.yaml MUST 支持配置
  `codegraph.autoMaintain: 'manual' | 'sync' | 'auto'`
  （缺省 manual = 现状），strictObject 校验非法值拒绝；单次
  调用旗标可覆盖。
- **FR-002**: sync 档 MUST 且仅在 stale 时自动执行一次
  `codegraph sync` 并重查健康度；auto 档额外在 uninitialized
  时自动执行一次 `codegraph init` 并重查；命中后走 CodeGraph
  加速路径。
- **FR-003**: manual 档（含缺省）MUST 与当前行为完全一致
  （零维护调用）；unavailable 状态任何档位零维护调用。
- **FR-004**: 维护 MUST 单次（一次调查至多一次动作，禁止循环）
  且受超时上限约束（默认 300s 可配）；超时/失败 → 终止子进程
  并按现状降级链处理。
- **FR-005**: 维护结果 MUST 反映在 fallback 记录与事件流：
  尝试过（动作/结果/耗时）进入 fallback detail；事件
  codegraph.init.started/completed/failed 与
  codegraph.sync.started/completed/failed 全程发射（M11 事件
  全集扩展）。
- **FR-006**: 维护动作 MUST 以子进程封装现成 codegraph CLI
  （宪法 VI：零重实现），Fleet 不解析/不管理索引内部格式。
- **FR-007**: 降级语义 MUST 与宪法 I 完全一致：维护失败只允许
  造成 慢 / Token 多，MUST NOT 导致调查失败。
- **FR-008**: 断言以注入式替身 CLI 驱动（Fake adapter /
  脚本替身：成功 / 失败 / 挂起超时三态），不依赖真实 CodeGraph。

### Key Entities

- **MaintainPolicy**: `'manual' | 'sync' | 'auto'`（fleet.yaml
  codegraph.autoMaintain；旗标覆盖优先）。
- **MaintainAction**: `'init' | 'sync'` + 结果
  `'completed' | 'failed' | 'timeout'` + durationMs。
- **维护事件**: codegraph.init.started/completed/failed ·
  codegraph.sync.started/completed/failed（payload：动作、
  结果、耗时、策略档位）。
- **MaintenanceConfig**: autoMaintain + timeoutMs（fleet.yaml
  codegraph 段）。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 三档矩阵 e2e/单测全绿：manual 零调用零变化、
  sync 档 stale→恰一次 sync→命中、auto 档 uninitialized→恰
  一次 init→命中（事件与 pathsUsed 断言）。
- **SC-002**: 故障三态（失败/超时/维护后仍 stale）全部降级
  完成调查，零崩溃零悬挂，fallback 含维护尝试信息。
- **SC-003**: 单次语义：任一调查的维护动作事件总数 ≤ 1。
- **SC-004**: 默认 manual 全量回归零变化（既有测试 100% 绿）。
- **SC-005**: unavailable 三档零维护调用。

## Assumptions

- **默认 manual 是刻意保守**：M2 决策"Fleet 不会代为执行"对
  未配置仓库继续成立；本特性把它从"硬编码"改为"可配置"，仅
  opt-in 仓库获得自动维护。宪法无对应条款、降级语义不变，
  **无需修宪**。
- 三档而非两档：init（首次建索引）显著重于 sync，单列让用户
  精确控制成本上限。
- 维护只在 investigate 入口健康检查处同步触发（无后台守护 /
  无定时任务——确定性内核纪律）。
- 超时上限单一值（默认 300s）覆盖 init 与 sync（配置粒度
  到段不到动作——避免配置面膨胀）。
- 并发不加固：跨进程索引写安全属 codegraph 自身职责；文档
  提示 CI 场景预热或 manual。
- MCP repo_investigate 经同一 investigate 路径自动获得同语义。
- 落位 packages/repository（investigate 维护前置 + Fake
  adapter 维护注入点）+ core config schema 扩展；CLI 旗标
  （--codegraph-maintain）+ 零新增第三方依赖。
