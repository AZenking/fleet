# Implementation Plan: M4 Core Domain（任务域实体与校验）

**Branch**: `005-m4-core-domain` | **Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/005-m4-core-domain/spec.md`

## Summary

新增 `packages/mission` 包：Mission / Plan / Task / Requirement /
Constraint / Acceptance / Artifact / Run 的 Zod schema 与 `fleet
mission validate <path>` 校验链。加载器复刻 M0 config 模式（YAML →
strictObject → FleetError + 逐字段 ConfigIssue，一次报全），交叉
校验（重复 task id / 悬空依赖 / 自环 / execution 完备性）作为
Zod 之后的语义层。`missions/demo.yaml` 作为活样例与夹具。零新增
第三方依赖；core 与既有包零改动。

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 24（同 M0 基线）

**Primary Dependencies**: 零新增——Zod / yaml（core 模式复用）；
`@fleet/core` 的 FleetError / ConfigIssue / RealFileSystem /
readFileOptional；CLI 侧 commander 既有

**Storage**: 无持久化（Run 持久化在 M11）；mission 文件是唯一
输入（`missions/*.yaml`，单文件单 mission）

**Testing**: Vitest——单元（schema 矩阵 + 语义规则矩阵，纯函数）、
进程级 e2e（tests/cli/mission.test.ts，10 类故障注入对照
SC-002/003）、demo.yaml 作为"永远合法"夹具

**Target Platform**: macOS 本地（同 M0–M3）

**Project Type**: monorepo 新增 packages/mission 包 + CLI 命令 +
missions/ 目录

**Performance Goals**: 单文件校验 < 1s（SC-001，实际 < 10ms 量级）

**Constraints**: 一次报全错误（FR-007 不首错即停）；确定性
（SC-004）；未知字段拒绝（strictObject）；planningMode 语义 =
宪法 V 的输入契约（execution 必带已确认 plan + 非空 tasks）

**Scale/Scope**: 单 mission 文件；10 类故障矩阵 100% 拦截
（SC-002）；M5 边界——图语义（环检测/拓扑/就绪）不在此层

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 宪法条款 | 评估 | 结果 |
|---|---|---|
| I. Repository Truth Model | N/A（不消费加速器） | PASS |
| II. 权限与隔离 | 角色仅做枚举校验（reflex/focus/reason/insight/wisdom）；执行期强制归 M7/M8（spec Assumption 划界） | PASS |
| III. Independent Validation | N/A（无实现型角色） | PASS |
| IV. Role/Runtime 解耦 | 实体不绑定 Runtime/Provider；Task.agentRole 是认知角色枚举，与 Runtime 无关 | PASS |
| V. Deterministic Kernel First | planningMode 语义钉进输入契约（execution 不可无方案）；校验全确定性 | PASS |
| VI. Reuse Over Reimplementation | 加载器复刻 core config 模式；复用 ConfigIssue/FleetError；零新增依赖 | PASS |
| Architecture Constraints 技术栈 | 沿用既有依赖与包结构约定（packages/mission 对齐 core/repository 模板） | PASS |
| Non-Goals（Fleet 1.0 前） | 未触碰（无模板/跨文件引用/批量校验） | PASS |

## Project Structure

### Documentation (this feature)

```text
specs/005-m4-core-domain/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── cli.md           # fleet mission validate 命令契约
│   └── mission-file.md  # mission 文件格式契约（含 demo 样例逐字段）
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root，M4 增量)

```text
packages/mission/
├── src/
│   ├── index.ts         # 公共出口
│   ├── types.ts         # 全部实体 Zod schema（Mission/Plan/Task/Requirement/Constraint/Acceptance/Artifact/Run）
│   ├── loader.ts        # loadMission：raw YAML → Mission（FleetError，issues 逐字段）
│   ├── semantic.ts      # 语义校验：重复 task id / 悬空依赖 / 自环 / execution 完备 / requirement id 唯一
│   └── validate.ts      # validateMissionFile：读文件 + 组合两层 → MissionValidationReport
├── package.json         # @fleet/mission（依赖 @fleet/core、zod、yaml）
├── tsconfig.json        # 继承 base
└── tsup.config.ts       # 对齐 packages/core 模板

apps/cli/src/commands/mission.ts        # fleet mission validate 注册
missions/demo.yaml                      # 活样例（合法 execution mission，兼作夹具）
tests/cli/mission.test.ts               # e2e：故障注入矩阵 + 摘要输出
```

**Structure Decision**: 遵循 roadmap 的 `packages/mission` 独立包
（M5 Scheduler、M6 Runtime 从这里消费实体）；`missions/` 目录随
本里程碑落地；core 与既有包零改动（mission 专属错误码定义在
mission 包内，复用 FleetError 载体与 ConfigIssue 结构）。

## Complexity Tracking

> 无宪法违规需要辩护，本表为空。

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
