# Research: M3 Evidence System

**Date**: 2026-09-10 | **Status**: 全部技术决策已定（spec 无 NEEDS
CLARIFICATION；此处解决 plan 层实现选型）

关键输入：M1 已落地的 investigate 编排 / policy 规则 / verifyAnchor，
M2 已落地的 queryWiki / loadWikiPages，宪法 V（确定性）与 I（加速器
非依赖）。

## D1 — Finding 合成策略（确定性模板，无 LLM）

- **Decision**: resolver 按**确定性模板**把 references + wiki 命中
  归组为 findings，四类：
  1. **符号 finding**：plan 中每个符号 →「{symbol} 共 N 处引用，
     定义于 {首个定义文件:行}」，evidence = 该符号全部 references
  2. **文件组 finding**：剩余 references 按顶层目录归组 →「关键词
     在 {dir}/ 命中 N 处」，evidence = 组内 references
  3. **wiki finding**：wiki 命中 →「仓库知识层中 N 页与问题相关
     （{标题列表}）」，evidence = wiki 页面证据
  4. **insufficient finding**：零证据 → 单条 insufficient 标注
     （FR-009），不产出无据 statement
- **Rationale**: FR-011/宪法 V——语句生成必须是模板拼接而非理解；
  模板让"同问题同 findings"（SC-003）结构性成立。
- **Alternatives considered**: 按文件逐条生成 finding（碎片化）；
  LLM 总结陈述（违反确定性）。

## D2 — 模式裁决：auto 默认 + 高风险强制

- **Decision**: `--mode auto|fast|verify`，缺省 `auto`：
  - `auto`：高风险命中 → verify，否则 fast
  - `fast`：高风险命中 → **仍升级 verify**（FR-005，spec 明确
    "显式 fast 不能豁免"）
  - `verify`：恒 verify
  - 裁决输出 ModeResolution：`requestedMode / effectiveMode /
    escalations[]（命中规则 + 原因）`，写入结果（FR-004 可追溯）
- 高风险表在 M1 `detectHighRisk`（动态/反射/配置驱动/生成代码）
  之上扩展 M3 语义表：删除/修改公共 API、Service、DB Schema、
  Authentication、Payment、大范围 Refactor（关键词 + 路径模式，
  如 `db/schema`、`migrations/`、`auth/`、`payment/`、`api/` +
  删除类动词）。新表落位 evidence/rules.ts，M1 表保持不动（引用
  级复核语义不变，模式级升级是新职责）。
- **Rationale**: spec FR-004/005 的直接落地；规则表分离让 M1
  行为零回归。

## D3 — FAST 语义：跳过强制源码锚定，置信度封顶

- **Decision**: fast 模式下 codegraph 候选**不做 verifyAnchor
  强制复核**（保留 verified=false，evidence 标注"未经源码复核"），
  confidence 封顶 medium；以下三种情况自动落入 VERIFY 全链：
  1. 高风险命中（D2）
  2. 加速源（wiki + codegraph）零命中（FR-008）
  3. 加速源全部不可用（wiki 缺失/stale 且 codegraph 不可用）
  自动落入时记录 modeEscalation（原因），结果照常返回。
- **Rationale**: "耗时显著低于 verify"只能来自跳过锚定复核
  （M1 健康路径的主要成本之一）；verified=false + confidence
  封顶保证"快速"不冒充"确凿"（FR-002 的 verified 语义延续）。
- **Alternatives considered**: fast 也全锚定（则 fast=verify 无意义）；
  fast 信任 codegraph 且 verified=true（冒充源码证据，违反 M1
  FR-008 精神）。

## D4 — wiki 证据源：复用 queryWiki + 三态判定

- **Decision**: evidence/wiki-source.ts 包装 M2 `queryWiki`：
  - 判定顺序：wiki 目录/index 缺失 → `wiki_missing`；loadWikiPages
    解析失败 → `wiki_broken`；轻量 stale 检查（git HEAD ≠ index
    锚点，复用 M2 status 逻辑）→ `wiki_stale`；命中 → wiki 证据
    （location = 页面路径，excerpt = 命中片段，verified = 页面
    存在于磁盘）
  - stale 时**降级不使用**（与 codegraph stale 语义对齐——过期
    知识比没有知识危险）
  - 三态全部只记 FallbackReason，不影响调查成败（宪法 I）
- FallbackReason code 枚举扩展三个值：`wiki_missing / wiki_stale /
  wiki_broken`（M1 九码之后追加，向后兼容）。
- **Rationale**: spec US3 场景 2 的三态命名；复用 M2 判定逻辑
  零重实现。

## D5 — config 证据源：扩展名重分类规则

- **Decision**: 不新增配置扫描器。规则：references 中文件路径
  命中配置扩展名（复用 M1 `CONFIG_EXTENSIONS`：yaml/yml/json/
  toml/ini/env）→ 该条 evidence 的 source 重分类为 `config`
  （location/snippet 不变）；高风险的配置驱动问题因此天然获得
  config 证据（spec edge case：rates 上限来自 `config/rates.yaml`）。
- **Rationale**: search/codegraph 已经扫到配置文件，重分类是零
  成本的第四源；独立配置解析器属过度设计（宪法 VI）。
- **Alternatives considered**: 专门 config 扫描阶段（新代码路径，
  收益仅限"未被关键词命中的配置"——超出本里程碑价值）。

## D6 — confidence 规则表（确定性映射）

- **Decision**: evidence 构成 → confidence，规则表
  （`evidence/confidence.ts`，输入输出均可序列化复现）：
  - **high**：≥1 条 verified 的 source/config 证据 **且** 证据源
    ≥2 类（多源一致）**且** 无未决冲突
  - **medium**：（≥1 条 verified 单源）或（多源但含未复核加速源）
    或 fast 模式封顶
  - **low**：仅未复核证据、或存在未决冲突、或存在 verified=false
    的锚点失效
  - 规则命中原因随 finding 输出（`confidenceReason`，SC-003 可
    解释性的载体）
- **Rationale**: FR-003 确定性 + 可解释；fast 封顶在 D3 已定，
  表中体现为"fast 模式最高 medium"。
- **Alternatives considered**: 打分制（连续分数需阈值，仍是离散
  判定的复杂化）。

## D7 — 冲突检测：位置/存在性级 + EvidenceConflict 结构

- **Decision**: 两类检测（spec Assumption 的显式边界）：
  1. **锚点偏移**：M1 verifyAnchor 发现 codegraph 位置与源码不符
     （已有 conflict FallbackReason）→ M3 起同时在该 finding 附
     EvidenceConflict：`{accelerated 陈述+位置} vs {source 实际
     位置}`，胜出方 source，原因 `static_truth_wins`
  2. **wiki 死路径**：wiki 命中片段中提取路径 token（复用 M2
     validator 的 extractPathTokens）→ 磁盘不存在 → EvidenceConflict
     （wiki 声称 vs 源码事实），胜出方 source
  冲突不裁决删除证据，只标注（可追溯优于整洁）。
- **Rationale**: SC-005 的两类注入场景对应；语义级冲突需要 LLM，
  显式排除。
- **Alternatives considered**: 冲突即丢弃败方证据（不可追溯，
  违反 M3 初衷）。

## D8 — 兼容策略：只增不改

- **Decision**: InvestigationResult 以**可选字段**扩展：
  `findings?: Finding[]`、`mode?: ModeResolution`（schema 从
  strictObject 增可选键，旧消费者零感知）；references/fallbacks/
  summary/退出码语义原样。`repo.investigate.completed` 事件
  payload 增 `findingsCount / effectiveMode / confidence`（可选
  字段，不破坏 M1 断言）。
- **Rationale**: M1 的 CLI 契约与测试是资产；M3 是增量层。
- **Alternatives considered**: 新命令 `investigate --findings`
  分叉输出（命令面膨胀，违反"无新命令族"spec 边界）。

## D9 — 测试策略

- **Decision**: 三层：
  1. **单元**（evidence/ 模块）：模式裁决矩阵（auto/fast/verify ×
     高风险命中/不命中）、confidence 规则表全分支、resolver 分组
     确定性（同输入同输出 + 模板断言）、config 重分类、wiki-source
     四态（fresh 命中/missing/stale/broken）、冲突两类
  2. **e2e**（tests/cli/investigate-evidence.test.ts，夹具仓库）：
     fast vs verify 证据构成对照、高风险矩阵六类（默认 + 显式
     fast 双调用）、wiki build 后含 wiki 证据 + 整删 wiki 前后
     输出一致（SC-004）、假 codegraph 偏移行号 + 构造 wiki 死路径
     页的冲突注入（SC-005）
  3. **走查**（quickstart）：本仓库真实问题 + wiki 已建，SC-001
     抽查与 SC-006 计时
- **Rationale**: SC-002/003/005 的矩阵只能靠注入与自动化；
  SC-004 需要在"集成后"重新钉死（M2 的隔离测试不覆盖 investigate
  读 wiki 的新路径）。

## D10 — 预算与上限

- **Decision**: 单 finding evidence 上限 10 条（超出截断并在
  finding 标注 truncated）；wiki 检索预算沿用 M2（rg 3s/上限）；
  FAST/VERIFY 总预算沿用 M1（10s，超时截断标注）；config 重分类
  零额外成本。
- **Rationale**: FR-010 与 SC-006 的落点；防大仓库发散。
