# Feature Specification: M3 Evidence System（调查证据体系）

**Feature Branch**: `004-m3-evidence-system`

**Created**: 2026-09-10

**Status**: Draft

**Input**: User description: "开始下一个任务" — 对应
`agent-fleet-roadmap.md` Phase A / M3：让 Agent 不只输出结论，还输出
证据来源；Wiki 正式接入调查链；建立 FAST / VERIFY 调查模式与冲突
裁决。完成本里程碑即达成 **Repository Intelligence 0.1** release gate。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 结论带证据链 (Priority: P1)

作为 Fleet 开发者（或 Codex Desktop 会话），我对仓库提出调查问题，
`fleet repo investigate` 的输出从"一堆引用"升级为**结论**：每个
Finding 是一条可读的 statement（如 "FleetError 定义于
packages/core/src/errors/index.ts:34"），附带证据链——多条
Evidence，各自标明来源（wiki / codegraph / search / source /
config）与位置，以及置信度（high / medium / low）与已知冲突。我
能据此判断"这个结论可信到什么程度、依据在哪"。

**Why this priority**: 这是 M3 的存在理由（roadmap 验收锚点
"Investigation 有 Evidence"），也是后续 Fleet Agent 之间以结构化
产物交换结论的地基——没有证据链的结论无法被 Insight/Wisdom 复核。

**Independent Test**: 在本仓库运行 investigate "FleetError 在哪里
定义"，检查输出的 findings：statement 可读、evidence 至少一条且
source=source 锚定真实文件行、confidence 与证据构成一致。

**Acceptance Scenarios**:

1. **Given** 任一调查问题，**When** investigate 完成，**Then**
   `--json` 输出含 findings 数组：每个 finding 有 statement、
   evidence（≥1 条）、confidence；M1 的 references 保持向后兼容
   （作为证据锚定明细）。
2. **Given** 一个 finding 的证据，**When** 逐一核对 evidence 的
   location，**Then** source/config 证据 100% 指向磁盘真实文件位置，
   wiki 证据 100% 指向存在的 wiki 页面。
3. **Given** 问题无任何可用证据，**When** 调查完成，**Then** 明示
   "证据不足 / unverified"，不冒充有据结论，退出码语义不变。
4. **Given** 同一问题重复调查，**When** 对比两次输出，**Then**
   confidence 与 findings 判定完全一致（确定性，无随机）。

---

### User Story 2 - FAST / VERIFY 调查模式 (Priority: P2)

作为 Fleet 开发者，我用 `--mode fast` 追求速度（加速源健康时直接
产出证据），用 `--mode verify` 追求确凿（全链复核：原生搜索 →
源码 + 配置）。不指定模式时，系统按问题风险自动选择——**删除或
修改公共 API / Service / DB Schema / Authentication / Payment /
大范围 Refactor / 配置驱动行为等高风险判断，默认升级 VERIFY**，
即使显式给了 fast。

**Why this priority**: Token 与可信度的分档控制是 Repository
Intelligence 的效率核心：日常导航问题不该付全链复核的成本，而
高风险结论不该被加速源的一言之词定案（宪法 I：加速器不是真相源）。

**Independent Test**: 对同一问题分别跑 `--mode fast` 与
`--mode verify`：verify 的证据构成包含 source/config 复核层而
fast 不强制；高风险关键词问题在两种调用下都出现 verify 升级
记录。

**Acceptance Scenarios**:

1. **Given** wiki 与 codegraph 均健康，**When**
   `investigate --mode fast`，**Then** 证据主要来自加速源，耗时
   显著低于同问题 verify 模式，mode 记录在输出中。
2. **Given** 任一模式，**When** 问题命中高风险特征（公共 API /
   Service / DB Schema / 认证 / 支付 / 大范围重构 / 配置驱动），
   **Then** 自动升级 VERIFY，升级记录（原因 + 命中规则）结构化
   可查，且证据最终锚定源码/配置。
3. **Given** fast 模式下加速源全部不可用，**When** 调查执行，
   **Then** 自动走 VERIFY 底层链（search → source），降级记录
   可查，调查不失败。
4. **Given** verify 模式，**When** 加速源给出的位置与源码复核
   不一致，**Then** 以源码为准，conflict 进入该 finding。

---

### User Story 3 - Wiki 接入与冲突裁决 (Priority: P3)

作为 Codex Desktop 会话，我在调查时自动获得 wiki 的知识加速：
问题相关时，wiki 页面内容与出处作为一类证据参与结论；wiki 与
codegraph、wiki 与源码的陈述冲突被结构化裁决——**Source +
Config 是 Static Truth，加速源败出时留下 EvidenceConflict 记录**，
而不是静默丢弃。wiki 缺失、stale、损坏时调查照常（宪法 I 的
集成后验证）。

**Why this priority**: M2 建好的 wiki 至此才被消费，Phase A 的
三层加速结构（Wiki → CodeGraph → Native）闭环；冲突裁决让
"加速器说错了"成为可观测事件而非隐患。

**Independent Test**: 夹具仓库上：有 wiki 时 investigate 输出含
wiki 证据；整体删除 `.fleet/wiki` 后同一调查仍成功且输出与无 wiki
基线一致（0 例失败）——即 M2 的 SC-005 在集成后依然成立。

**Acceptance Scenarios**:

1. **Given** 已构建且新鲜的 wiki，**When** 调查命中 wiki 覆盖的
   主题（如 "调查链路在哪个包"），**Then** findings 含 wiki 来源
   证据（页面路径 + 相关片段），并在加速路径上先于全链扫描返回。
2. **Given** wiki 整体缺失 / stale / 结构损坏，**When** 调查执行，
   **Then** 记录降级（missing / stale / broken），走 codegraph →
   search → source 链，退出码与结果语义不受影响。
3. **Given** wiki 页面声称的位置与源码事实不一致，**When** 调查
   完成，**Then** 该 finding 附 EvidenceConflict（双方陈述 + 胜出
   方），最终证据以源码为准。
4. **Given** wiki 证据引用的页面被删除，**When** 复核该证据，
   **Then** 标注 verified=false 并降低该 finding 置信度，不移除
   记录（可追溯优于整洁）。

---

### Edge Cases

- 证据锚点失效（文件已修改 / wiki 页已删）：verified=false +
  confidence 降级，不静默移除（US1 场景 3 精神）。
- 同名 symbol 多候选：M1 的 ambiguous 语义升级——每个候选成为
  独立 finding 或同一 finding 的并列证据，冲突不裁决为单一答案。
- 高速路径零命中而 verify 命中：fast 结果为空不是失败，输出建议
  verify 的提示（退出码 0）。
- 非 git 仓库 / 无 wiki / 无 codegraph 的"三无"环境：VERIFY 底层
  链（walk 搜索 + 源码阅读）仍可产出 source 证据。
- 配置文件作为证据：命中 yaml/json/toml 配置时其键值参与陈述
  （如配置驱动行为问题的 rates 上限来自 `config/rates.yaml`）。
- 证据数量上限：单 finding 证据条数有上限（防大仓库发散），
  超出截断标注。
- M1 兼容：`repo.investigate.completed` 事件 payload 扩展
  （findingsCount / mode / confidence 分布），不破坏既有字段。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: investigate MUST 输出 findings：每个 finding 含
  statement（一句可读结论）、evidence（≥1 条）、confidence
  （high/medium/low）、conflicts（0..n）；`--json` 结构化，退出码
  语义沿用全局契约（0 完成 / 1 自身失败 / 2 用法错误）。
- **FR-002**: 每条 Evidence MUST 标注 source 枚举
  （wiki/codegraph/search/source/config；lsp/compiler/test/runtime
  为类型占位）与 location；source/config 证据 MUST 锚定磁盘真实
  位置，wiki 证据 MUST 锚定存在的 wiki 页面；锚定复核失败的
  MUST 标注 verified=false。
- **FR-003**: confidence MUST 由确定性规则推导（证据源数量、
  是否经源码复核、多源是否一致、是否存在未决冲突），同输入同
  输出，推导依据可从输出解释。
- **FR-004**: `--mode fast|verify` MUST 支持：FAST 优先加速源直接
  出证据；VERIFY 强制全链（原生搜索 → 源码 + 配置复核）；实际
  使用的 mode 与升级记录 MUST 写入输出。
- **FR-005**: 高风险特征（公共 API / Service / DB Schema /
  Authentication / Payment / 大范围 Refactor / 配置驱动行为）
  MUST 默认升级 VERIFY；命中规则 MUST 结构化记录；显式 fast
  不能豁免高风险升级。
- **FR-006**: wiki MUST 作为调查链的加速源参与：相关命中产出
  wiki 证据；缺失 / stale / 损坏 MUST 降级（codegraph → search →
  source）且不影响调查成败（宪法 I，M2 SC-005 集成后仍成立）。
- **FR-007**: 加速源（wiki / codegraph）陈述与 Static Truth
  （source + config）冲突时 MUST 以 Static Truth 胜出，并记录
  EvidenceConflict（双方陈述、位置、胜出方与原因）。
- **FR-008**: FAST 模式下加速源全部不可用或零命中时 MUST 自动
  走 VERIFY 底层链，降级记录可查；FAST 空结果 MUST 提示 verify
  建议，退出码 0。
- **FR-009**: finding 无法获得任何证据时 MUST 输出
  insufficient-evidence 标注，不产出无据 statement。
- **FR-010**: 单 finding 证据条数 MUST 有上限，超出截断并标注；
  调查总预算沿用 M1（超时 / 限流 / 产物目录排除语义不变）。
- **FR-011**: 高风险判定与 confidence 规则 MUST 是确定性规则表
  （无 LLM），可从输出追溯命中原因（FR-011 对齐 M1 的 FR-011
  确定性约束）。

### Key Entities

- **Finding**: statement、evidence[]、confidence
  （high/medium/low）、conflicts[]、insufficient 标注。
- **Evidence**: source（九源枚举）、location（文件:行 / wiki
  页面 / 配置键）、excerpt（≤5 行）、verified（锚定复核结果）。
- **EvidenceConflict**: 双方（来源 + 陈述 + 位置）、胜出方、
  原因（static_truth_wins）。
- **InvestigationMode**: `fast` / `verify` + 实际生效模式与升级
  记录（modeEscalation：命中规则 + 原因）。
- **ConfidenceRule（规则表）**: 证据构成（源数 / 复核与否 /
  一致性 / 冲突）→ confidence 的确定性映射。
- **HighRiskRule（规则表）**: 高风险特征 → 强制 VERIFY 的确定性
  判定（关键词 / 路径模式）。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 抽查全部 findings 的 evidence：source/config 证据
  100% 锚定磁盘真实位置，wiki 证据 100% 锚定存在的页面，
  verified 标注与实际一致。
- **SC-002**: 高风险问题矩阵（公共 API 删除 / 认证 / 支付 / DB
  Schema / 大范围重构 / 配置驱动）在默认与显式 fast 两种调用下
  100% 升级 VERIFY 且证据最终锚定源码/配置。
- **SC-003**: 同一问题的 confidence 与 findings 判定 100% 可复现
  （重复调查输出一致）。
- **SC-004**: 整体删除 `.fleet/wiki` 后，investigate 成功率
  100%（0 例失败），行为与无 wiki 基线一致（宪法 I 集成验证）。
- **SC-005**: 冲突注入（假后端返回偏移位置 / 构造过期 wiki 页）
  场景 100% 产生 EvidenceConflict 且 Static Truth 胜出。
- **SC-006**: 加速源健康的 FAST 路径耗时 ≤ 10s（沿用 M1 SC-001
  预算），且不高于同问题 VERIFY 路径。

## Assumptions

- 证据源本里程碑实现 wiki / codegraph / search / source / config
  五源；lsp / compiler / test / runtime 在枚举中占位，接入属后续
  里程碑（roadmap Phase C/D）。
- M1 的 InvestigationResult.references 保留为兼容层；findings 是
  新增输出层，两者的关系（引用共享或内联）由 plan 决定。
- config 证据 = 调查命中配置文件（yaml/json/toml）时以其键值
  参与陈述；专门的配置 schema 解析不在此范围。
- 高风险判定与 confidence 为内置确定性规则表；规则的用户可配置
  性推迟（roadmap Phase C 的 Tool Policy 范围）。
- wiki 证据的相关性判定复用 M2 的检索能力（全文 + index），
  不引入新的索引机制。
- conflict 的检测范围 = 位置/存在性级冲突（行号偏移、路径失效、
  符号不存在）；语义级冲突检测需要 LLM，超出确定性内核约束
  （宪法 V），不在此里程碑。
- fleet 命令面无新增命令族：本里程碑扩展 `fleet repo investigate`
  的输出与 `--mode` 选项；`fleet doctor` / `fleet wiki` 不变。
