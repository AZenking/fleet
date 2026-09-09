# Agent Fleet

多 Agent 软件工程运行时：把已经明确的 Mission 组织成 DAG，调度
Reflex / Focus / Reason / Insight / Wisdom 五个认知角色完成实现、验证与
Review。Codex Desktop 负责需求讨论与最终审阅，Repository Intelligence
负责大仓库的高效理解。

当前进度：**M0 Foundation 已交付**（工程基线 + 环境诊断 + 共享基础能力）。

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

## 仓库结构

```text
apps/cli/         fleet 命令行（doctor / version）
packages/core/    共享基础能力：config / errors / events / fs / git /
                  ids / logging / probe / diagnostics
configs/          fleet.yaml（仓库级 Fleet 配置）
tests/cli/        CLI 进程级 e2e
specs/            Spec Kit 规格与设计文档
```

## 文档

- 架构基线：`agent-fleet-architecture.md`
- 路线图：`agent-fleet-roadmap.md`
- M0 规格：[specs/001-m0-foundation/spec.md](specs/001-m0-foundation/spec.md)
- M0 验证手册：[specs/001-m0-foundation/quickstart.md](specs/001-m0-foundation/quickstart.md)
- 项目宪法：`.specify/memory/constitution.md`

## 质量门

```bash
pnpm lint         # ESLint（flat config + typescript-eslint）
pnpm format:check # Prettier 检查
pnpm test         # Vitest（core 单元 + CLI e2e）
pnpm check        # 上述全部 + build
```
