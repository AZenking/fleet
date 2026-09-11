# Data Model: M4 Core Domain

**Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

所有结构以 Zod 定义于 `packages/mission/src/types.ts`（strictObject
全树，未知字段拒绝）；文件格式样例与字段注释见
[contracts/mission-file.md](contracts/mission-file.md)。错误结构复用
core 的 `ConfigIssue`（path/expected/received/message）。

## 1. Mission

| 字段 | 类型 | 必填 | 规则 |
|---|---|---|---|
| `id` | string | 是 | `/^[a-z0-9][a-z0-9-]*$/`；文件内唯一（单文件单 mission） |
| `goal` | string | 是 | 非空 |
| `planningMode` | enum | 是 | `autonomous` / `execution`（大小写敏感） |
| `requirements` | Requirement[] | 是 | ≥1 条（FR-009） |
| `constraints` | Constraint[] | 否 | 默认 [] |
| `acceptance` | AcceptanceCriteria[] | 是 | ≥1 条，每条三段完整（FR-005） |
| `plan` | Plan | 否 | **execution 必填**（语义层，FR-003） |
| `tasks` | Task[] | 否 | execution 必填且非空；autonomous 可空（Reason 规划产生） |

## 2. Requirement

| 字段 | 类型 | 必填 | 规则 |
|---|---|---|---|
| `id` | string | 否 | 给定则 `/^[a-z0-9][a-z0-9-]*$/` 且 mission 内唯一 |
| `text` | string | 是 | 非空 |

## 3. Constraint（discriminatedUnion，FR-006）

| kind | 参数 | 规则 |
|---|---|---|
| `maxDurationMs` | `value: integer ≥ 0` | mission 时长上限（毫秒） |
| `maxTokens` | `value: integer ≥ 0` | mission token 预算上限 |

未知 kind 结构层拒绝；后续内建 kind 追加零破坏。

## 4. AcceptanceCriteria

| 字段 | 类型 | 必填 | 规则 |
|---|---|---|---|
| `given` | string | 是 | 非空（前置状态） |
| `when` | string | 是 | 非空（操作） |
| `then` | string | 是 | 非空（预期结果） |

## 5. Plan

| 字段 | 类型 | 必填 | 规则 |
|---|---|---|---|
| `summary` | string | 是 | 非空（已确认方案的一句话锚点） |
| `rationale` | string | 否 | 决策依据（Codex Desktop 确认记录的摘要） |

任务分解即 `mission.tasks`，不在 Plan 内重复建模（research.md D4）。

## 6. Task

| 字段 | 类型 | 必填 | 规则 |
|---|---|---|---|
| `id` | string | 是 | `/^[a-z0-9][a-z0-9-]*$/`；mission 内唯一（语义层） |
| `goal` | string | 是 | 非空 |
| `agentRole` | enum | 是 | `reflex` / `focus` / `reason` / `insight` / `wisdom`（宪法 II 认知五级） |
| `dependsOn` | string[] | 否 | 默认 []；引用的 id 必须存在（语义层）且不含自身（自环拒绝） |
| `constraints` | Constraint[] | 否 | 任务级约束（如单任务 token 上限） |
| `acceptance` | AcceptanceCriteria[] | 否 | 任务级验收覆盖 |

多节点环检测属 M5 DAG 模块（spec 划界）。

## 7. Artifact（定义不实例化，FR-008）

| 字段 | 类型 | 必填 | 规则 |
|---|---|---|---|
| `id` | string | 是 | `art_` 前缀 + 短 id |
| `taskId` | string | 是 | 产出该产物的任务（M5 运行时校验引用闭合） |
| `kind` | string | 是 | 产物类别（如 `findings` / `diff` / `report`，开放集） |
| `payload` | unknown | 是 | 结构化内容（kind 决定形态，M5/M6 细化） |
| `createdAt` | string | 是 | ISO 8601 |

## 8. Run（定义不实例化，FR-008）

| 字段 | 类型 | 必填 | 规则 |
|---|---|---|---|
| `id` | string | 是 | `run_` 前缀 + 短 id |
| `missionId` | string | 是 | 对应 Mission.id |
| `status` | enum | 是 | `pending` / `running` / `completed` / `failed` / `cancelled` |
| `startedAt` / `endedAt` | string | 否 | ISO 8601 |
| `taskRuns` | TaskRun[] | 否 | 任务级执行记录 |

**TaskRun**: `{ taskId, status: 同 Run.status 枚举 + skipped,
startedAt?, endedAt?, agentRole }`——状态机流转（pending →
running → completed/failed）由 M5 Scheduler 驱动，本里程碑只定义
合法形态。

## 9. MissionValidationReport

| 字段 | 类型 | 规则 |
|---|---|---|
| `ok` | boolean | issues 为空 |
| `mission?` | Mission | ok 时携带解析结果（CLI 渲染摘要） |
| `issues` | ConfigIssue[] | path（如 `tasks.1.agentRole`）/ expected / received / message |
| `fileError?` | string | 文件级故障（不存在/不可读/解析失败）单独标注 |

## 错误码（mission 包内，research.md D2）

`MISSION_FILE_MISSING` / `MISSION_FILE_UNREADABLE` /
`MISSION_PARSE_FAILED`（YAML 语法、多文档、非对象顶层）/
`MISSION_INVALID`（结构或语义校验失败）——全部经 FleetError
（category 'config'）抛出，issues 进 context。

## 状态转换

无运行时状态——M4 是纯函数层：文件 →（解析 → 结构校验 → 语义
校验）→ Report。Run/TaskRun 的状态机仅定义 schema（消费方 M5）。

## 实体关系总览

```text
mission.yaml ─loadMission→ Mission ─semantic→ MissionValidationReport
    Mission 1─N Task（dependsOn 同层引用闭合）
    Mission 1─N Requirement / Constraint / AcceptanceCriteria
    Mission 1─1 Plan?（execution 必备）
    Run N─1 Mission（M5 产生）；Run 1─N TaskRun N─1 Task
    Task 1─N Artifact（M5/M6 产生）
```
