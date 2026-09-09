# Research: M1 CodeGraph + Fallback

**Date**: 2026-09-09 | **Status**: 全部 NEEDS CLARIFICATION 已解决

关键输入：对本机 codegraph 1.4.1 的实测探测（2026-09-09）。

## 实测发现（适配层契约的事实基础）

- 命令面：`init / index / sync / status / query / explore / node /
  files / callers / callees / impact / affected / daemon / unlock`。
- JSON 支持：`query / callers / callees / impact / status` 均有 `-j,
  --json`；**`explore` 与 `node` 只有文本输出**（与 MCP 工具同源）。
- `status --json` 字段：`initialized / version / lastIndexed /
  fileCount / nodeCount / edgeCount / pendingChanges{added,modified,
  removed} / index{reindexRecommended, state} / worktreeMismatch`——
  健康、stale、版本兼容一应俱全。
- `query --json` 返回数组：`{node: {id, kind, name, qualifiedName,
  filePath, language, startLine, endLine, startColumn, endColumn,
  isExported, ...}, score, ...}`——天然就是 Reference 的结构化来源。
- `init` 在本仓库实测 138ms / 181 节点 / 350 边——索引成本对本规模
  可忽略，但 Fleet 仍不主动重建（宪法 VI）。

## D1 — CodeGraph 接入协议

- **Decision**: CLI 子进程（execa 调 `codegraph <cmd> --json`）。
- **Rationale**: JSON 面覆盖全部结构化需求（query/callers/callees/
  impact/status）；无 daemon 依赖、无握手协议、超时即 kill，故障
  语义最干净。MCP 是给 Desktop/Agent 的接入面（M12 才暴露），
  Fleet 内部不走 MCP。
- **Alternatives considered**:
  - MCP client 直连：多一层会话管理，超时/崩溃语义复杂，收益为零
  - 直读 `.codegraph/` SQLite：绑定内部 schema，违反原则 VI

## D2 — 原生搜索实现

- **Decision**: ripgrep 优先（`rg --json` 逐行事件流），缺失时降级为
  内置文件遍历（复用 core 的 fs 抽象，streamline 读文件 + 正则匹配），
  结果标注 `degraded`。
- **Rationale**: rg 是事实标准且本机可用；内置遍历保证"最终兜底是
  文件系统本身"（spec US2 场景 4）。两者产出统一 SearchHit 结构。
- **Alternatives considered**: 只用 rg——违反最终兜底要求；只用内置
  遍历——大仓库性能不可接受。

## D3 — 问题解析（确定性规则）

- **Decision**: 三类 token 提取 → 检索计划：
  1. 符号样式：驼峰/帕斯卡/snake_case/全大写常量（如 `FleetError`、
     `loadFleetConfig`）→ 走 symbol 查询（query + callers/callees）
  2. 路径样式：含 `/` 或带扩展名的 token → 范围限定
  3. 其余关键词（去停用词）→ 文本搜索
  问题为空或只有一个符号时直接走符号路径。
- **Rationale**: FR-011 要求无 LLM 的可复现解析；该规则覆盖
  quickstart 的两类典型问题（自然语言 / 纯符号名）。
- **Alternatives considered**: 简单全文透传给 rg——丢失结构路径，
  CodeGraph 优势归零。

## D4 — stale 判定与处置

- **Decision**: `!initialized || pendingChanges 总和 > 0 ||
  reindexRecommended || index.state !== 'complete'` 任一命中即 stale。
  处置：降级到 search/source + fixSuggestion 提示用户执行
  `codegraph sync`（或 `init`）。Fleet 永不自动 init/index/sync。
- **Rationale**: 宪法 VI——索引是 CodeGraph 的资产；且自动重建可能
  在大仓库触发长任务，违背 M1 的超时预算。

## D5 — 降级链与策略结构

- **Decision**: investigate 编排为固定流水：
  `plan → codegraph(health, query, relations) → policy.validate →
  (不通过) search → policy.validate → source 锚定复核 → 汇总`。
  policy.validate 输入候选 references + 触发上下文，输出
  accept / escalate(reason)。高风险模式命中时无条件 escalate 到
  source 复核（FR-007）。
- **Rationale**: 与架构图回退链一一对应；每一步的 escalate 都落
  FallbackReason（code + detail），满足 SC-003 可解释性。

## D6 — 测试夹具策略

- **Decision**: 三层夹具：
  1. `tests/fixtures/sample-repo`：手工小仓库（5–8 文件、已知符号名、
     含一个同名符号对与一个"配置驱动"文件），e2e 在其上初始化真实
     codegraph 索引验证健康路径；
  2. `FakeCodeGraphAdapter`：脚本化返回（成功/超时/歧义/空/冲突），
     驱动单元测试全矩阵，不依赖真实安装；
  3. PATH 隔离：e2e 用受控 PATH 前置空目录模拟 codegraph 缺失。
- **Rationale**: SC-002 要求 7 场景 100% 覆盖——真实后端只能覆盖
  健康/缺失两类，其余必须靠假后端注入。

## D7 — 范围与排除

- **Decision**: 默认排除目录：`node_modules / dist / build / coverage /
  .git / .codegraph / .fleet`；`--include-generated` 可显式放开。
  目标仓库解析顺序：`--repo` 参数 > fleet.yaml `repository` > cwd
  （经 findGitRepo 定位仓库根）。
- **Rationale**: spec 边界（产物目录默认排除）；与 M0 doctor 的
  配置语义一致。

## D8 — 预算与限流

- **Decision**: 单次 codegraph 调用 timeout 5s（kill 后降级）；rg
  timeout 3s、`--max-count` 与结果上限 100；source 复核条数上限 20；
  investigate 总预算 10s（SC-001），超预算部分截断并在结果中标注。
- **Rationale**: 超时即降级、限流防大仓库失控（spec 边界"不做无限
  扫描"）。
