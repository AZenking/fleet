# Implementation Plan: M0 Foundation（工程基线）

**Branch**: `001-m0-foundation` | **Date**: 2026-09-09 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-m0-foundation/spec.md`

## Summary

建立 Agent Fleet monorepo 工程基线：一条命令的质量门（安装 → lint →
test 全绿或非零退出）、`fleet doctor` 环境诊断（error / warning 分级，
CodeGraph 与 Agent Runtime 缺失仅为 warning，支持 `--json`），以及
packages/core 共享基础能力（配置加载与 Schema 校验、错误模型、日志
接口、事件接口、ID 生成、文件系统抽象、Git 仓库检测、探测原语）。
M0 只交付 apps/cli 与 packages/core 两个实际可用的子包，其余子包按
里程碑增量创建。

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 24（宪法 Architecture
Constraints 固定；`package.json` engines 为最低版本唯一真源）

**Primary Dependencies**: pnpm workspace、tsup（构建）、Vitest（测试）、
Zod（Schema）、execa（子进程）、yaml（配置解析）、commander（CLI 框架，
见 research.md D1）、ESLint flat config + Prettier（质量门，见
research.md D2）、semver（版本满足性检查）

**Storage**: N/A（无数据库；文件系统承载 `configs/fleet.yaml` 与
`.fleet/` 运行时目录，经文件系统抽象访问）

**Testing**: Vitest（unit + 组件级）；CLI 进程级 e2e 用 execa 拉起真实
`fleet` 二进制验证退出码与输出

**Target Platform**: macOS（darwin arm64）本地开发环境为主；不依赖
平台特定 API，Node 支持范围内保持跨平台

**Project Type**: monorepo（library + cli）

**Performance Goals**: `fleet doctor` 健康环境 ≤ 5 秒出完整报告
（SC-002）；全新克隆到质量门全绿 ≤ 10 分钟（SC-001）

**Constraints**: 完全离线可用（不依赖网络服务）；CodeGraph / Agent
Runtime 缺失不得导致 doctor 失败（宪法原则 I）；所有配置校验错误
必须逐字段结构化（FR-007）

**Scale/Scope**: 单人开发；M0 范围 = apps/cli + packages/core + 根
工作区配置；五类故障注入识别率 100%（SC-003）

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 宪法条款 | 评估 | 结果 |
|---|---|---|
| I. Repository Truth Model | doctor 对 CodeGraph / Runtime 仅 warning，不判定不就绪；M0 不接入 Wiki/CodeGraph 功能 | PASS |
| II. 权限与隔离由系统强制 | M0 无 Agent 角色与 Workspace 写入；文件系统抽象为其铺路 | PASS（N/A 项无违反） |
| III. Independent Validation | 质量门由仓库自身独立执行，不依赖任何自报 | PASS |
| IV. Role / Runtime 解耦 | M0 不绑定任何真实 Runtime；doctor 仅做存在性探测占位 | PASS |
| V. Deterministic Kernel First | 质量门与 doctor 全部确定性，无 LLM 参与 | PASS |
| VI. Reuse Over Reimplementation | 探测复用系统命令（which 风格）、ID 用 crypto.randomUUID、不造轮子 | PASS |
| Architecture Constraints 技术栈 | TS / Node 24 / pnpm / tsup / Vitest / Zod / execa / yaml 完全遵循 | PASS |
| Non-Goals（Fleet 1.0 前） | M0 未触碰任何禁止项 | PASS |

## Project Structure

### Documentation (this feature)

```text
specs/001-m0-foundation/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── cli.md
│   └── fleet-yaml.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
agent-fleet/
├── apps/
│   └── cli/
│       ├── src/
│       │   ├── bin.ts               # fleet 入口（commander 注册）
│       │   ├── commands/
│       │   │   ├── doctor.ts        # 检查编排（逐项 ok/warning/error）
│       │   │   └── version.ts
│       │   └── output/
│       │       ├── human.ts         # 人类可读渲染
│       │       └── json.ts          # --json 结构化输出
│       └── package.json
├── packages/
│   └── core/
│       ├── src/
│       │   ├── config/
│       │   │   ├── schema.ts        # FleetConfiguration zod schema
│       │   │   └── loader.ts        # 读取 + 校验 + 逐字段错误
│       │   ├── errors/              # FleetError 统一错误模型
│       │   ├── logging/             # Logger 接口 + 默认实现
│       │   ├── events/              # FleetEvent schema（仅定义与序列化）
│       │   ├── ids/                 # 前缀 + randomUUID
│       │   ├── fs/                  # 文件系统抽象（真实/内存双实现）
│       │   ├── git/                 # 仓库检测（向上找 .git）
│       │   └── probe/               # 命令存在性探测（node/git/codegraph/runtimes）
│       └── package.json
├── configs/
│   └── fleet.yaml                   # 仓库级 Fleet 配置
├── tests/
│   └── cli/                         # CLI 进程级 e2e（execa 拉起真实 bin）
├── package.json                     # 根：scripts（install→lint→test 一键）
├── pnpm-workspace.yaml
├── vitest.workspace.ts              # 跨包测试编排
├── tsconfig.base.json
├── eslint.config.js
└── .prettierrc
```

**Structure Decision**: monorepo（pnpm workspace），apps（可执行物）与
packages（库）分层；M0 只包含 cli 与 core，后续 Milestone 按 roadmap
§11 目标形态增量添加子包，无需改动根工作区配置。

## Complexity Tracking

> 无宪法违规需要辩护，本表为空。

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
