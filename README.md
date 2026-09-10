# Agent Fleet

多 Agent 软件工程运行时：把已经明确的 Mission 组织成 DAG，调度
Reflex / Focus / Reason / Insight / Wisdom 五个认知角色完成实现、验证与
Review。Codex Desktop 负责需求讨论与最终审阅，Repository Intelligence
负责大仓库的高效理解。

当前进度：**M0 Foundation / M1 CodeGraph + Fallback / M2 LLM Wiki 已交付**
（工程基线 + 环境诊断 + 仓库调查链路 + 仓库持久知识层）。

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

仓库调查：对一个仓库问题返回带源码锚点的引用。CodeGraph 健康时走
结构化路径（符号 + 调用关系）；不可用、超时、索引过期、符号缺失/
歧义、与源码冲突时自动降级到原生搜索（ripgrep → 内置遍历）——
调查永不因 CodeGraph 失败而失败。

```bash
pnpm fleet repo investigate "loadFleetConfig 在哪里被抛出"   # 文本
pnpm fleet repo investigate "FleetError" --json             # 结构化
# 可选：--repo <path> 目标仓库；--max-refs <n> 引用上限；
#       --include-generated 包含产物目录
```

- 输出记录服务路径（codegraph / search / source）、耗时与全部降级
  原因（code + detail），`--json` 与文本模式退出码语义一致。
- 关键证据一律锚定到真实源码位置（Static Truth = Source）。
- 索引过期只提示 `codegraph sync` 建议，Fleet 永不代为重建（宪法 VI）。
- 验证手册：[specs/002-m1-codegraph-fallback/quickstart.md](specs/002-m1-codegraph-fallback/quickstart.md)

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
apps/cli/               fleet 命令行（doctor / version / repo investigate / wiki）
packages/core/          共享基础能力：config / errors / events / fs / git /
                        ids / logging / probe / diagnostics
packages/repository/    Repository Intelligence：codegraph 适配层 +
                        原生回退（search / source / git）+ investigate 编排 +
                        wiki（格式层 / 生成 / 校验 / 状态 / 更新 / 检索）
configs/                fleet.yaml（仓库级 Fleet 配置）
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
- 项目宪法：`.specify/memory/constitution.md`

## 质量门

```bash
pnpm lint         # ESLint（flat config + typescript-eslint）
pnpm format:check # Prettier 检查
pnpm test         # Vitest（core 单元 + CLI e2e）
pnpm check        # 上述全部 + build
```
