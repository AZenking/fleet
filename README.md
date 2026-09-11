# Agent Fleet

多 Agent 软件工程运行时：把已经明确的 Mission 组织成 DAG，调度
Reflex / Focus / Reason / Insight / Wisdom 五个认知角色完成实现、验证与
Review。Codex Desktop 负责需求讨论与最终审阅，Repository Intelligence
负责大仓库的高效理解。

当前进度：Phase A（Repository Intelligence 0.1）与 Phase B
（**Fleet Kernel M4–M6**）已交付；Phase C 进行中——M7 五角色
Agent + 真实 Runtime、**M8 Workspace + Git Worktree（物理隔离）**。

## 要求

- Node.js ≥ 24（`node -v` 确认）
- pnpm 11+（`corepack enable`）
- git

## 快速开始

```bash
pnpm install     # 安装 workspace 依赖
pnpm build       # 构建全部包（core → cli）
pnpm check       # 质量门：lint + format + build + test，一条命令
```

任何失败都会以非零退出码结束并逐条定位问题——这就是后续所有里程碑的
开发基线。

## fleet doctor

环境诊断：Node 版本 / Git 可用性 / 仓库识别 / Fleet 配置 / CodeGraph /
Agent Runtime。

```bash
pnpm fleet doctor            # 人类可读
pnpm fleet doctor --json     # 结构化输出（CI / Control Center 消费）
pnpm fleet --version
```

- 前四项为 error 级：任一失败即退出码 1 并附修复建议。
- CodeGraph 与 Agent Runtime 为 warning 级：缺失只提示可降级，
  不影响"环境就绪"判定（宪法原则 I：加速器不是硬依赖）。
- 退出码：`0` 无 error；`1` 存在 error；`2` 用法错误（两种输出模式一致）。

## fleet repo investigate

仓库调查：对一个仓库问题返回**证据化结论**（findings）——每条结论
是可读的 statement + 证据链（标注来源 wiki / codegraph / search /
source / config 与锚定状态）+ 置信度（确定性规则推导）+ 已裁决的
冲突（Static Truth 胜出留痕）。CodeGraph 健康时走结构化路径；不可
用、超时、索引过期、符号缺失/歧义、与源码冲突时自动降级到原生搜索
（ripgrep → 内置遍历）——调查永不因加速器失败而失败。

```bash
pnpm fleet repo investigate "loadFleetConfig 在哪里被抛出"        # 默认 auto
pnpm fleet repo investigate "FleetError" --mode verify --json     # 全链复核
pnpm fleet repo investigate "认证 login 流程" --mode fast         # 快速（高风险仍自动升级）
# 可选：--repo <path>；--max-refs <n>；--include-generated
```

- `--mode auto|fast|verify`：auto（缺省）按风险自动选择；fast 跳过
  强制源码复核（加速源证据标 verified=false、置信度封顶 medium）；
  verify 全链锚定。高风险判断（公共 API / Service / DB Schema /
  认证 / 支付 / 大范围重构 / 配置驱动）**默认强制 verify，显式 fast
  也不能豁免**；fast 零命中或加速源不可用时自动走 verify 全链。
- 置信度规则：未决冲突或全部未复核 → low；fast 封顶 medium；
  verified 多源一致 → high（规则可从 confidenceReason 追溯）。
- wiki 作为调查加速源参与（fresh 才使用；缺失/stale/损坏只降级），
  wiki 与源码冲突时 dead_path 留痕、codegraph 锚点偏移时以源码为准。
- 关键证据一律锚定到真实源码位置（Static Truth = Source +
  Config）；索引过期只提示 `codegraph sync` 建议，Fleet 永不代为
  重建（宪法 VI）。
- 验证手册：[specs/002-m1-codegraph-fallback/quickstart.md](specs/002-m1-codegraph-fallback/quickstart.md)（M1）/
  [specs/004-m3-evidence-system/quickstart.md](specs/004-m3-evidence-system/quickstart.md)（M3）

## fleet mission validate

Fleet Kernel 的输入契约：mission 文件（goal / requirements /
constraints / acceptance / planningMode / tasks）逐字段校验——
合法输出摘要；非法**一次报出全部错误**（字段路径 + 期望 + 实际 +
修复提示），拼写错误的未知字段直接拒绝。

```bash
pnpm fleet mission validate missions/demo.yaml          # 文本摘要
pnpm fleet mission validate missions/demo.yaml --json   # 结构化报告
```

- planningMode 语义（宪法 V 输入契约）：`execution`（方案已在
  Codex Desktop 确认）必须携带 plan 与非空 tasks，Reason 后续不得
  推翻；`autonomous` 只有 requirements 也合法（Reason 规划产生任务）。
- 两层校验：Zod 结构层（类型/枚举/未知字段）+ 语义层（task id
  唯一 / dependsOn 引用闭合且不自环 / execution 完备性）。
- 文件格式契约：[specs/005-m4-core-domain/contracts/mission-file.md](specs/005-m4-core-domain/contracts/mission-file.md)；
  活样例 `missions/demo.yaml`。
- 验证手册：[specs/005-m4-core-domain/quickstart.md](specs/005-m4-core-domain/quickstart.md)

## fleet run

执行 mission：M4 校验前置（非法文件零执行）→ M5 DAG 与确定性
调度（并发 3 / 重试 1 / 失败传播）→ Fake 运行时（模拟五角色
延迟画像）→ Run 报告（任务表 / 执行次数 / 传播链 / 事件）。

```bash
pnpm fleet run missions/demo.yaml            # 文本任务表
pnpm fleet run missions/demo.yaml --json     # RunReport（M4 Run 实例）
```

- 运行时可选择（`--runtime`）：缺省 **Fake**；`pi` / `codex` /
  `gemini` 真实 CLI 适配器（子进程 + 进程组 kill + 输出截断）；
  显式指定不可用即报错，**不静默降级**。
- **权限系统强制（宪法 II）**：五角色权限矩阵单一来源——
  reflex=轻写 / focus·insight·wisdom=只读 / reason=唯一深写；
  每个请求必带权限声明，裸请求被适配器拒绝（不启子进程）。
- **Worktree 物理隔离（M8）**：写授权角色（reason/reflex）在
  `.fleet/worktrees/` 专属 Git Worktree 执行，只读角色在主仓根；
  多任务并行互不污染、主仓零泄漏（SC-002 三段式验收）。merge
  不强合（冲突结构化报告）；成功即合/失败即弃（`--no-worktree`
  关闭）。六类故障（dirty/残留分支/空仓/上限/孤儿/清理失败）
  结构化处理；主仓 dirty 时拒绝执行（基线可复现优先）。
- 任务执行预算：task 级 maxDurationMs > mission 级 > 默认 5000ms
  （整段透传，超时即失败并按 M5 语义重试与传播）。
- autonomous mission（无任务）→ 提示"Reason 规划属 M7"并正常
  退出（M7 衔接点）。
- 验证手册：[specs/007-m6-runtime-fake-agents/quickstart.md](specs/007-m6-runtime-fake-agents/quickstart.md)

## fleet wiki

仓库持久知识层（LLM Wiki）：`.fleet/wiki/` 下的 Markdown 知识库，
带 front matter 元数据（generated_from git 锚点 / updated_at /
scope）与 generated 围栏——生成内容与人工内容物理隔离，更新永不
覆盖围栏外的人工补充。检索用全文搜索 + index 导航，无向量库
（宪法 VI）；Wiki 是加速器不是依赖，缺失或过期时其余命令照常工作
（宪法 I）。

```bash
pnpm fleet wiki init                        # 建立骨架（幂等）
pnpm fleet wiki build                       # 确定性事实提取（无 LLM）
pnpm fleet wiki status                      # 页面级 stale 判定
pnpm fleet wiki update                      # 只重算受影响页面
pnpm fleet wiki query "调查链路在哪个包"     # 全文检索 + 可解释排序
# 全部支持 --repo <path> / --json
```

- build 从仓库事实（包清单 / 依赖 / 模块注释 / 目录结构）生成页面
  骨架；深度叙述由人或外部 LLM 工具写在围栏外，受同等校验保护。
- stale 判定 = `git diff <锚点>..HEAD` 变化文件与页面 scope 的前缀
  交集（纯集合运算）；update 只触碰受影响页，mixed 页写前自动备份
  到 `.fleet/wiki/.backup/`。
- 验证手册：[specs/003-m2-llm-wiki/quickstart.md](specs/003-m2-llm-wiki/quickstart.md)

## 仓库结构

```text
apps/cli/               fleet 命令行（doctor / version / repo investigate / wiki / mission / run）
packages/core/          共享基础能力：config / errors / events / fs / git /
                        ids / logging / probe / diagnostics
packages/repository/    Repository Intelligence：codegraph 适配层 +
                        原生回退（search / source / git）+ investigate 编排 +
                        wiki（格式层 / 生成 / 校验 / 状态 / 更新 / 检索）+
                        evidence（findings / 模式裁决 / 置信度 / 冲突）
packages/mission/       Fleet Kernel 任务域：Mission/Task/Artifact/Run
                        实体 schema + 两层校验（loader + semantic）
packages/scheduler/     Fleet Kernel 调度层：Task DAG（环检测/就绪
                        选择）+ Rule-based Scheduler（并发/重试/传播）
packages/runtime/       Fleet 运行时层：RuntimeAdapter 契约 + Fake
                        （timeout/cancel/清理合同化）+ 桥接 + run 编排
                        + CLI 适配器基座与 pi/codex/gemini + 探测
packages/agents/        Fleet 认知角色层：五角色定义 + 权限矩阵
                        （Tool Policy）+ 运行时注册表 + 角色执行器
packages/workspace/     Fleet 物理工作区层：Git Worktree 隔离
                        （create/diff/merge/destroy）+ 处置装饰器 +
                        孤儿检测与最小清理
packages/validation/    Fleet 独立验收层：Validation Runner
                        （diff/lint/typecheck/tests）+ Wisdom 审阅
                        循环（maxReviewLoops 上限强制）+ 验证门
configs/                fleet.yaml（仓库级 Fleet 配置）
missions/               mission 文件（demo.yaml 为活样例）
tests/cli/              CLI 进程级 e2e
tests/fixtures/         调查夹具仓库（sample-repo）
specs/                  Spec Kit 规格与设计文档
```

## 文档

- 架构基线：`agent-fleet-architecture.md`
- 路线图：`agent-fleet-roadmap.md`
- M0 规格：[specs/001-m0-foundation/spec.md](specs/001-m0-foundation/spec.md)
- M1 规格：[specs/002-m1-codegraph-fallback/spec.md](specs/002-m1-codegraph-fallback/spec.md)
- M2 规格：[specs/003-m2-llm-wiki/spec.md](specs/003-m2-llm-wiki/spec.md)
- M3 规格：[specs/004-m3-evidence-system/spec.md](specs/004-m3-evidence-system/spec.md)
- M4 规格：[specs/005-m4-core-domain/spec.md](specs/005-m4-core-domain/spec.md)
- M5 规格：[specs/006-m5-dag-scheduler/spec.md](specs/006-m5-dag-scheduler/spec.md)
- M6 规格：[specs/007-m6-runtime-fake-agents/spec.md](specs/007-m6-runtime-fake-agents/spec.md)
- M7 规格：[specs/008-m7-agents-real-runtime/spec.md](specs/008-m7-agents-real-runtime/spec.md)
- M8 规格：[specs/009-m8-workspace-worktree/spec.md](specs/009-m8-workspace-worktree/spec.md)
- M9 规格：[specs/010-m9-validation-review-loop/spec.md](specs/010-m9-validation-review-loop/spec.md)
- 项目宪法：`.specify/memory/constitution.md`

## 质量门

```bash
pnpm lint         # ESLint（flat config + typescript-eslint）
pnpm format:check # Prettier 检查
pnpm test         # Vitest（core 单元 + CLI e2e）
pnpm check        # 上述全部 + build
```
