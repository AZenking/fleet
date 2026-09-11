# Contract: mission 文件格式（M4）

**Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

mission 文件是 Fleet Kernel 的输入契约（Codex Desktop → Fleet 的
交接物）。单文件单 mission，YAML，未知字段拒绝（拼写错误不静默
丢失）。

## 完整样例（missions/demo.yaml 的形态）

```yaml
id: demo-mission
goal: 为 CLI 增加 mission 校验能力并保持质量门全绿
planningMode: execution        # autonomous | execution（大小写敏感）

requirements:
  - id: req-schema
    text: 提供完整实体 schema 与逐字段校验
  - id: req-cli
    text: 提供 fleet mission validate 命令

constraints:
  - kind: maxDurationMs
    value: 3600000
  - kind: maxTokens
    value: 500000

plan:                           # execution 必填；autonomous 可省
  summary: 复用 config 加载模式新建 packages/mission
  rationale: 已在 Codex Desktop 确认（2026-09-11 会话）

tasks:                          # execution 必填非空；autonomous 可省
  - id: define-schema
    goal: 定义全部实体 Zod schema 与语义校验
    agentRole: reason           # reflex|focus|reason|insight|wisdom
    dependsOn: []
  - id: wire-cli
    goal: 注册 fleet mission validate 命令与渲染
    agentRole: reason
    dependsOn: [define-schema]

acceptance:
  - given: 仓库处于 M3 完成状态
    when: 运行 fleet mission validate missions/demo.yaml
    then: 退出码 0 且输出摘要
  - given: 注入任一故障矩阵场景的文件
    when: 运行校验
    then: 退出码 1 且逐条列出含字段路径的错误
```

## 字段速查

| 路径 | 必填 | 约束 |
|---|---|---|
| `id` | 是 | `/^[a-z0-9][a-z0-9-]*$/` |
| `goal` | 是 | 非空 |
| `planningMode` | 是 | `autonomous` / `execution` |
| `requirements[]` | 是（≥1） | `text` 非空；`id?` 唯一 |
| `constraints[]` | 否 | kind ∈ {maxDurationMs, maxTokens}，value 为非负整数 |
| `plan` | execution 必填 | `summary` 非空；`rationale?` |
| `tasks[]` | execution 必填非空 | `id` 唯一；`agentRole` 五角色；`dependsOn` 引用存在且不自环 |
| `acceptance[]` | 是（≥1） | given/when/then 三段非空 |

## 模式语义（宪法 V 输入契约）

- **execution**：方案已在 Codex Desktop 确认——plan + tasks 必备，
  M7 起 Reason 只做执行拆解、MUST NOT 推翻 plan。
- **autonomous**：只有 requirements——tasks 由 Reason 规划产生
  （合法空态）。

## 错误语义

- 文件级：`MISSION_FILE_MISSING` / `MISSION_FILE_UNREADABLE` /
  `MISSION_PARSE_FAILED`（含多文档 YAML、顶层非对象）。
- 校验级：`MISSION_INVALID`，`context.issues` 逐字段
  （path 如 `tasks.1.agentRole`，expected/received/message），
  **一次报全**（不首错即停）。
