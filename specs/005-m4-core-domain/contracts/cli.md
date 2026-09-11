# Contract: fleet mission validate（M4）

**Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

退出码沿用全局契约：`0` 校验通过；`1` 校验失败或文件不可读；
`2` 用法错误（path 缺失、未知选项）。文件格式契约见
[mission-file.md](mission-file.md)。

## 命令

```bash
fleet mission validate <path> [--json]
```

| 项 | 说明 |
|----|------|
| `<path>` | 必填。mission 文件路径（惯例 `missions/*.yaml`，任意位置可显式指定） |
| `--json` | 结构化输出（MissionValidationReport） |

## JSON 输出

通过（退出码 0）：

```json
{
  "ok": true,
  "summary": {
    "id": "demo-mission",
    "goal": "为 CLI 增加 mission 校验能力并保持质量门全绿",
    "planningMode": "execution",
    "taskCount": 2,
    "acceptanceCount": 2,
    "constraintCount": 2
  }
}
```

失败（退出码 1）——issues 一次报全（FR-007）：

```json
{
  "ok": false,
  "issues": [
    {
      "path": "planningMode",
      "expected": "autonomous | execution",
      "received": "Execution",
      "message": "无效的 planningMode（大小写敏感）"
    },
    {
      "path": "tasks.1.dependsOn",
      "expected": "引用存在的 task id",
      "received": "nonexistent-task",
      "message": "悬空依赖：wire-cli 依赖的 nonexistent-task 不存在"
    }
  ]
}
```

文件级故障：`{ "ok": false, "fileError": "文件不存在：/path/x.yaml" }`。

## 文本输出（默认）

通过：

```text
✓ mission 校验通过：demo-mission（execution）
  目标：为 CLI 增加 mission 校验能力并保持质量门全绿
  任务 2 · 验收 2 · 约束 2
```

失败：逐条 `[path] 期望 …，实际 …：message`；文件级故障单独一行。
`mission.validated` 事件走 stderr（payload：`{ path, ok, issueCount }`）。

## 事件

`mission.validated`——与 doctor / investigate / wiki 同模式，
不污染 --json 的 stdout。
