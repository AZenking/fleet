# Feature Specification: M2 LLM Wiki（仓库持久知识层）

**Feature Branch**: `003-m2-llm-wiki`

**Created**: 2026-09-10

**Status**: Draft

**Input**: User description: "执行下一个任务" — 对应
`agent-fleet-roadmap.md` Phase A / M2：建立 Repository Persistent
Knowledge Layer（LLM Wiki），让 Codex / Agent 不必每轮全文阅读仓库
即可建立对 Repository 的认知。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 初始化、构建与导航 (Priority: P1)

作为 Fleet 开发者，我在目标仓库运行 `fleet wiki init` 与
`fleet wiki build`，得到 `.fleet/wiki/` 知识库：`index.md` 导航入口、
architecture / domains / infrastructure / decisions 分区与
glossary。build 产出的不是空占位：每个分区包含基于仓库当前事实的
条目（模块、入口、职责），每页头部带元数据（generated_from git
sha、updated_at、scope）。读者（Codex 会话或人）从 index 出发，
两跳内可到达任何主题页面。

**Why this priority**: 知识层的载体。M2 验收锚点 "Codex 能通过 Wiki
理解 Repository" 的前提是 wiki 存在、真实、可导航；没有它，query
与增量更新都无对象。

**Independent Test**: 在本仓库运行 init + build，检查：目录结构
完整、每页元数据齐全、index 覆盖全部页面、页面中的路径引用 100%
指向真实存在的文件。

**Acceptance Scenarios**:

1. **Given** 从未初始化 wiki 的仓库，**When** `fleet wiki init`，
   **Then** 建立 wiki 目录骨架（index + 四个分区 + glossary），
   重复 init 幂等，不破坏已有内容。
2. **Given** 已初始化，**When** `fleet wiki build`，**Then** 各分区
   生成基于仓库事实的条目，每页带 generated_from（当前 HEAD sha）、
   updated_at、scope 元数据，index.md 完整反映全部页面。
3. **Given** build 完成，**When** 校验任意页面的路径引用与内部
   链接，**Then** 全部指向真实存在的文件 / 页面（0 死链）。
4. **Given** 非 git 仓库或无提交历史，**When** build，**Then**
   明确标注 generated_from 不可得（不伪造锚点），构建不失败。

---

### User Story 2 - 提问检索 (Priority: P2)

作为 Codex Desktop 会话（或任何 Agent / 人），我用
`fleet wiki query "认证系统怎么工作？"` 提问，得到按相关度排序的
wiki 页面片段与出处，据此定向阅读，无需全文扫描仓库。

**Why this priority**: Wiki 的价值出口是 Token 效率——用最小阅读量
建立仓库认知。没有 query，wiki 只是一堆待翻的文件。

**Independent Test**: 对本仓库问 "investigate 的降级链路怎么走"，
query 返回 M1 相关页面与片段；再用一个无关问题验证空结果语义。

**Acceptance Scenarios**:

1. **Given** 已构建且新鲜的 wiki，**When** query 命中主题，
   **Then** 返回相关页面路径 + 片段 + 排序依据，`--json` 结构化
   输出，退出码 0。
2. **Given** 问题在 wiki 中无命中，**When** query，**Then** 返回
   明确空结果（附可用主题建议），退出码仍为 0（无结果 ≠ 失败，
   与 M1 语义一致）。
3. **Given** wiki 不存在 / 损坏 / stale，**When** query，**Then**
   明确报告状态与修复建议（init / build / update），不假装有知识，
   不崩溃。

---

### User Story 3 - 增量更新与 stale 识别 (Priority: P3)

作为 Fleet 开发者，仓库演进后我运行 `fleet wiki status` 查看新鲜度
（wiki 落后 HEAD 多少、哪些变化文件影响哪些页面），再运行
`fleet wiki update` 只重算受影响页面；手工补充的叙述内容在更新中
被识别并保护，不被静默覆盖。

**Why this priority**: 持久知识层的生命周期管理。全量重建在大仓库
不可持续；stale 的知识比没有知识更危险——它冒充真相。

**Independent Test**: build 后修改 packages/repository 下若干文件并
提交，status 列出受影响页面映射；update 后仅这些页面元数据刷新，
其余页面 updated_at 不变；手工编辑过的区段完好。

**Acceptance Scenarios**:

1. **Given** wiki 的 generated_from 落后于 HEAD，**When**
   `fleet wiki status`，**Then** 报告 stale、差距（提交 / 文件），
   以及"变化文件 → 受影响页面"映射。
2. **Given** status 显示部分页面受影响，**When** `fleet wiki
   update`，**Then** 仅受影响页面被重算并刷新元数据，未受影响页面
   逐字节不变，index 同步更新。
3. **Given** 页面含人工编辑内容，**When** update 重算该页，
   **Then** 人工内容被识别并保留或明确警告 + 备份，绝不静默丢弃。
4. **Given** 变更删除 / 重命名了 wiki 引用的文件，**When**
   update，**Then** 死引用被检测并报告，不产出指向不存在文件的
   页面。
5. **Given** 大规模重构导致全部页面 scope 失效，**When** status，
   **Then** 报告影响面并建议全量 rebuild，不在此场景下假装增量
   可行。

---

### Edge Cases

- wiki 目录被手工破坏（缺 index / 元数据残缺 / 分区缺失）：
  Validator 输出结构化错误清单与修复建议，命令不崩溃。
- wiki 与仓库事实冲突（页面声称的路径 / 符号已不存在）：以仓库为准
  （Static Truth），报告 conflict——与 M1 的"源码胜出"原则一致。
- `.fleet/wiki` 属于生成产物目录：`fleet repo investigate`
  MUST NOT 把 wiki 页面当作源码证据（M1 的产物排除机制覆盖 wiki
  目录）；wiki query 检索 wiki 自身则不受此限制。
- 超大仓库 / 二进制 / 非 UTF-8 文件：构建与检索跳过并记录，不失败。
- 中英文混合问题与中英文 wiki 内容：query 两种语言都可命中。
- 空分区（如 decisions 尚无决策记录）：分区保留骨架与说明，不报错。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `fleet wiki init` MUST 建立 wiki 目录结构（index 入口、
  architecture / domains / infrastructure / decisions 分区、
  glossary），且幂等：重复 init MUST NOT 破坏或清空已有内容。
- **FR-002**: `fleet wiki build` MUST 产出反映仓库当前结构的最小
  可用内容（导航入口 + 分区骨架 + 基于仓库事实的条目），而非空
  占位；每个生成页面 MUST 带元数据：generated_from（git sha；不可
  得时显式标注）、updated_at、scope。
- **FR-003**: index.md MUST 覆盖全部页面并作为导航入口；任意页面
  从 index 出发可达。
- **FR-004**: wiki 页面中的路径引用与内部链接 MUST 锚定真实存在的
  文件 / 页面；Validator MUST 在 build / update 后校验（元数据
  完整性、链接有效性、结构完整性），失败时输出结构化错误，退出码
  语义与既有 CLI 契约一致（0 = 完成，1 = 自身失败，2 = 用法错误）。
- **FR-005**: `fleet wiki query "<问题>"` MUST 基于全文检索 + 文件
  导航 + index 返回按相关度排序的页面片段与出处，支持 `--json`；
  检索 MUST NOT 依赖向量数据库或嵌入服务（宪法 VI）。
- **FR-006**: query 无命中时 MUST 返回明确空结果（附可用主题
  建议），退出码 0；wiki 缺失 / 损坏 / stale 时 MUST 明确报告状态
  与修复建议，MUST NOT 假装知识可用。
- **FR-007**: `fleet wiki status` MUST 报告新鲜度：fresh / stale
  判定、generated_from 与 HEAD 的差距、变化文件 → 受影响页面的
  映射。
- **FR-008**: `fleet wiki update` MUST 基于"git diff → 变化文件 →
  受影响模块 / 符号 → 受影响页面"的确定性映射只重算受影响页面；
  未受影响页面 MUST 保持不变。
- **FR-009**: 更新 MUST NOT 静默覆盖人工编辑内容：人工内容 MUST
  被识别，并保留或明确警告 + 备份。
- **FR-010**: wiki 子系统的任何状态（缺失、损坏、stale）MUST NOT
  影响既有命令（`fleet repo investigate`、`fleet doctor` 等）的
  行为（宪法 I：加速器不是硬依赖）。
- **FR-011**: wiki 的生成、更新、新鲜度判定 MUST 是确定性过程，
  无 LLM 运行时依赖；内容充实接口 MUST 可插拔（人工或外部 LLM
  工具写入的内容同样受元数据与 Validator 约束）。
- **FR-012**: build / update / query 的耗时与规模 MUST 有上限保护：
  大仓库下增量路径不退化为全量重建，检索不做无限扫描。

### Key Entities

- **WikiPage**: 路径、标题、所属分区、内容、元数据、内容来源
  （generated / manual / mixed）。
- **WikiMetadata**: generated_from（git sha）、updated_at、scope
  （覆盖的仓库路径 / 模块）。
- **WikiIndex**: 全部页面的层级导航目录（分区 → 页面 → 主题）。
- **WikiStatus**: 存在性、fresh / stale 判定、与 HEAD 的差距、
  变化文件 → 受影响页面映射。
- **WikiQueryResult**: 问题、命中列表（页面 + 片段 + 相关度排序
  依据 + 出处）、空结果时的主题建议。
- **ValidationReport**: 校验项（元数据 / 链接 / 结构 / 引用
  存在性）与结构化错误清单。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 在本仓库（agent-fleet monorepo）上，init + build 在
  30 秒内完成，且产出通过 Validator 校验（0 错误）。
- **SC-002**: 一组关于仓库结构的走查问题（如"调查链路在哪个包"、
  "降级触发条件有哪些"、"宪法对 Wiki 的约束是什么"），仅凭
  wiki query + 页面导航作答，正确率 ≥ 80%——这是 M2 验收锚点
  "Codex 能通过 Wiki 理解 Repository" 的操作化。
- **SC-003**: 构造已知变更集（改动某包若干文件并提交）后，update
  对受影响页面的刷新率 100%，无关页面 0 变化（逐字节比对）。
- **SC-004**: stale 判定 100% 准确：generated_from 落后必报
  stale，一致必报 fresh，无假阴性 / 假阳性。
- **SC-005**: 整体删除 `.fleet/wiki` 后，`fleet repo investigate`
  与 `fleet doctor` 行为不变（0 例失败、无 wiki 相关回归）。
- **SC-006**: 命中主题的 query 在 2 秒内返回结果（本地全文检索
  规模的仓库）。

## Assumptions

- Wiki 落位 `.fleet/wiki/`（roadmap 定义）；wiki 是普通 Markdown
  文本，可被 git 管理，是否提交由用户决定（默认不加入忽略清单）。
- 第一版检索 = ripgrep 全文搜索 + index 导航 + 元数据过滤，无
  向量库（宪法 VI）；ripgrep 缺失时降级为内置遍历扫描（沿用 M1
  的 degraded 语义）。
- 内容生成的默认形态：确定性骨架 + 仓库结构事实（模块清单、入口、
  分区、术语骨架）；深度叙述由人工或外部 LLM 工具（如 Codex
  Desktop 会话）补充，内容源可插拔。Fleet 内置 LLM 生成待
  RuntimeAdapter（M6+）就绪后再评估——若预期 build 直接产出 LLM
  叙述内容，请在 clarify 阶段提出。
- `fleet repo investigate` 消费 wiki 作为加速来源属 M3 Evidence
  （FAST 模式）范围；M2 只要求 wiki 子系统独立可用且与既有命令
  互不干扰。
- 复用 M0 core（filesystem abstraction、error model、logging、
  config）与 M1 已有的产物目录排除、探测能力。
- 落位遵循 roadmap 的 packages/repository/wiki 结构（generator /
  updater / index / validator 四模块），具体拆分留给 plan 阶段。
