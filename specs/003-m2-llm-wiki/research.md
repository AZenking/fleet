# Research: M2 LLM Wiki

**Date**: 2026-09-10 | **Status**: 全部技术决策已定（spec 无 NEEDS
CLARIFICATION 残留，此处解决 plan 层实现选型）

关键输入：M1 已落地代码（searchPatterns 双引擎、FileSystemPort、
事件模式、CLI 契约）与宪法 VI（无向量库）/ 原则 I（加速器非依赖）。

## D1 — Wiki 文件格式：Markdown + YAML front matter + generated 围栏

- **Decision**: 每页 = front matter（yaml，复用已装 `yaml` 库解析，
  自研 `---` 分隔的轻量 split，不引入 gray-matter）+ 正文；正文中
  生成器产出的区块用 HTML 注释围栏包裹：
  `<!-- fleet:generated -->` … `<!-- /fleet:generated -->`。
- **Rationale**: 围栏是实现 FR-009（人工内容不被静默覆盖）的机制
  核心——重算只重写围栏内内容，围栏外天然保留；HTML 注释对人和
  LLM 渲染均不可见，不污染阅读。front matter 是 Jekyll/Hugo 事实
  标准，任何 LLM 工具零学习成本。
- **Alternatives considered**:
  - sidecar 元数据文件（`.meta.yaml`）：文件数翻倍，导航与 diff 割裂
  - 手工编辑检测（hash 对比上次生成产物）：需保存生成产物副本，
    状态复杂且不可解释

## D2 — 页面 origin 判定（generated / manual / mixed）

- **Decision**: 由围栏结构推导，无独立字段：
  - 有围栏 + 围栏外无实质内容 → `generated`
  - 有围栏 + 围栏外有内容 → `mixed`
  - 无围栏 → `manual`（完全人工页面，用户可自建）
- update 语义按 origin 分派：`generated` 整页重算；`mixed` 仅重写
  围栏内；`manual` 完全不动，报告中提示"该页需人工更新"。
- **Rationale**: FR-009 的"保留"路径——mixed 页的人工区物理上不在
  重写范围内，无需备份机制即满足"绝不静默丢弃"。

## D3 — scope 映射：路径前缀规则（确定性）

- **Decision**: front matter `scope` = 仓库相对路径前缀数组（元素
  形如 `packages/core` 或 `packages/core/src/config`，尾部 `/` 归一；
  `.` 表示全仓库）。受影响判定：changed file 以任一前缀开头 → 该页
  受影响。纯字符串前缀匹配，无 glob 引擎。
- build 时 scope 由生成器设定：`architecture/overview.md` → `.`；
  `domains/<包名>.md` → `packages/<包>`；`infrastructure/*.md` →
  对应配置文件/目录前缀；manual 页面 scope 由作者自填。
- **Rationale**: FR-008 要求确定性映射；前缀匹配可解释、可测试、
  零依赖。glob 会引入匹配语义争议（`**` 交叉行为），收益为零。
- **Alternatives considered**: glob 模式（复杂度不符）；符号级映射
  （依赖 CodeGraph，违反"Wiki 不依赖 CodeGraph"的加速器独立性）。

## D4 — stale 判定：页面级 + 整体合成

- **Decision**: `git rev-parse HEAD` 取当前 HEAD；`git diff --name-only
  <generated_from> HEAD` 取变化文件；页面 stale ⇔ 变化文件 ∩ 该页
  scope ≠ ∅；wiki 整体 stale ⇔ 任一页面 stale。generated_from 缺失
  （非 git 仓库）→ 整体 `unknown`，不猜测。
- **Rationale**: SC-004 要求 100% 准确——纯集合运算保证无假阴/假阳；
  页面级粒度直接服务增量更新（FR-008）。
- 大范围重构检测：受影响页面占比 > 70% 时 status 建议全量 rebuild
  （US3 场景 5），update 仍可执行但明确警告。

## D5 — 内容生成：确定性事实提取

- **Decision**: generator/skeleton.ts 从仓库事实提取（零 LLM）：
  - monorepo 探测（pnpm-workspace.yaml / lerna / 根 package.json
    workspaces）→ `domains/` 每包一页：包名、描述、依赖（区分
    fleet 内部依赖与外部）、scripts、目录结构、入口文件模块注释
    （本仓库惯例：index.ts 头部注释即模块说明）
  - `architecture/overview.md`：顶层结构 + 从各包 package.json 推导
    内部依赖图（文本邻接表，不画图）
  - `infrastructure/`：构建/测试/质量门（根 package.json scripts +
    配置文件存在性探测：eslint/vitest/tsconfig）
  - `decisions/` + `glossary.md`：骨架 + 填写说明（空分区不报错，
    spec edge case）
  - 非 monorepo 仓库：src/ 目录结构扫描兜底，同样产出真实条目
- 所有路径引用来自真实扫描结果 → 天然满足 FR-004 锚定校验。
- **Rationale**: spec Assumption 的默认形态（骨架 + 事实）；FR-011
  确定性要求；深度叙述由人工/外部 LLM 经围栏外区域或 manual 页补充。
- **Alternatives considered**: build 时调 LLM 生成叙述——M2 无
  RuntimeAdapter（M6+），且违反确定性约束。

## D6 — 检索：复用 M1 searchPatterns + 确定性排序

- **Decision**: query 的检索底座直接复用 `searchPatterns`，将
  `repoRoot` 指向 `.fleet/wiki`（其目录内部不存在 `node_modules` 等
  排除名，排除 glob 不干扰；rg 缺失自动降级 walk，语义与 M1 一致）。
  查询侧自研：停用词过滤 + 标点/空格分词（沿用 M1 planner 思路，
  中文按字符 bigram 补充匹配）→ 多 pattern 传入 searchPatterns →
  页面聚合排序：`标题命中 ×3 + 小节标题命中 ×2 + 正文命中行数 ×1`，
  ties 按页面路径字典序（全确定性）。
- 空结果 → 从 index.md 提取全部页面标题作为主题建议（FR-006）。
- **Rationale**: 宪法 VI 复用优先；SC-006 的 2s 预算在 wiki 目录
  规模（几十页）下宽裕。
- **Alternatives considered**: 为 wiki 单写检索器——重复实现；引入
  全文索引（lunr/flexsearch）——新依赖且违宪 VI。

## D7 — Validator 两级校验

- **Decision**:
  1. generated 区块内：提取形如路径的 token（含 `/` 且带已知扩展名，
     或反引号包裹的相对路径），逐一校验磁盘存在（锚定 FR-004）
  2. 全文档：markdown 链接 `[..](相对路径)` 目标存在性（含 `#锚点`
     剥离）
  3. 结构：index 存在且覆盖全部页面、四分区 + glossary 齐全、
     front matter 可解析且字段合法（generated_from 为 7–40 位 hex
     或缺失、updated_at 为 ISO 8601、scope 非空数组）
- 人工自由文本不校验路径（避免误报）；输出 ValidationReport
  （code + detail + pagePath），exit code 按全局契约。
- **Rationale**: spec edge case "手工破坏 → 结构化错误清单"；两级
  边界与 origin 判定一致（D2）。

## D8 — 与既有命令的隔离（宪法 I 落地证据）

- **Decision**: 零改动隔离——`.fleet` 已在 M1 `DEFAULT_EXCLUDED_DIRS`
  中（search.ts:44），investigate 永远不会把 wiki 页面当源码证据；
  wiki 模块只写 `.fleet/wiki/`；doctor 不增加 wiki 检查项（wiki 的
  状态自治由 `fleet wiki status` 承担，doctor 保持 M0 语义）。
- **Rationale**: FR-010 / SC-005 要求"删除 wiki 后既有命令行为不变"
  ——架构上不共享任何代码路径即可证明，测试用删除目录前后比对断言。

## D9 — CLI 退出码语义

- **Decision**（全局契约 0/1/2 之上细化）：
  - `init`：0 成功（幂等，重复执行无副作用）
  - `build`：0 成功（含非 git 仓库——显式标注 generated_from 缺失，
    不算失败）；1 自身失败（目标目录不存在等）
  - `status`：0（fresh / stale / unknown 都是有效状态）
  - `update`：0 成功（manual 页跳过只提示不失败）；1 失败
  - `query`：0（含空结果 + stale 警告下照常检索）；**wiki 缺失或
    结构损坏 → 1 + 修复指引**（无法完成检索功能本体，区别于
    "检索了但没有命中"）
- 事件沿用 M1 stderr 模式：`wiki.init/build/status/update/query
  .completed`。

## D10 — 测试策略

- **Decision**: 三层：
  1. 单元：MemoryFileSystem 注入 generator / updater / validator /
     format / status（git 函数以接口注入假实现），不触磁盘不依赖
     git
  2. e2e：`tests/cli/wiki.test.ts` 在 tmp 目录构建夹具 git 仓库
     （复用 tests/fixtures/sample-repo 内容 + git init + 两次提交），
     进程级跑 init→build→status→改文件→update→query 全链路，断言
     SC-003（受影响 100% 刷新、无关页面逐字节不变）与 SC-004
  3. 真实走查：本仓库自身（quickstart SC-002 认知问答 + SC-005
     删除隔离对照）
- **Rationale**: SC-003 的"逐字节不变"必须磁盘级断言；单元层的
  MemoryFileSystem 保证围栏重写逻辑的矩阵覆盖（generated/mixed/
  manual × 有/无冲突）。

## D11 — 性能与规模保护

- **Decision**: build 的仓库扫描复用 DEFAULT_EXCLUDED_DIRS + 文件数
  上限（10k 文件，超出截断并标注）；query 沿用 M1 预算（rg timeout
  3s / maxHits 100，walk 兜底）；update 只重算受影响页面，永不隐式
  全量（大范围重构场景仅建议 rebuild，D4）。
- **Rationale**: FR-012 上限保护；30s SC-001 预算对本仓库规模
  宽裕（预期 < 2s）。
