# Contract: fleet repo investigate（M1）

**Date**: 2026-09-09 | **Spec**: [spec.md](spec.md)

退出码沿用全局约定：`0` 完成（含"未找到相关内容"）、`1` 调查自身
失败（如目标目录不存在）、`2` 用法错误。

## 命令

```bash
fleet repo investigate "<question>" [options]
```

**参数与选项**：

| 项 | 说明 |
|----|------|
| `<question>` | 必填。自然语言或纯符号名（符号样式自动走结构路径） |
| `--repo <path>` | 目标仓库；缺省按 fleet.yaml `repository` → cwd 仓库根 |
| `--json` | 结构化输出（InvestigationResult，见 data-model.md §4） |
| `--max-refs <n>` | 引用条数上限，默认 20 |
| `--include-generated` | 放开产物目录排除（默认排除 node_modules/dist/build/coverage/.git/.codegraph/.fleet） |

**超时预算**（research.md D8）：codegraph 单调用 5s；rg 3s；总预算
10s，超出部分截断并在结果标注。

## JSON 输出

`--json` 输出 InvestigationResult 的稳定序列化：

```json
{
  "question": "FleetError 在哪里被抛出",
  "references": [
    {
      "filePath": "packages/core/src/config/loader.ts",
      "startLine": 40,
      "endLine": 46,
      "symbol": "loadFleetConfig",
      "kind": "function",
      "snippet": "throw new FleetError(ErrorCodes.CONFIG_MISSING, ...)",
      "origin": "codegraph",
      "verified": true
    }
  ],
  "pathsUsed": ["codegraph", "source"],
  "fallbacks": [
    { "code": "stale", "detail": "pendingChanges=3，建议执行 codegraph sync" }
  ],
  "durationMs": 812,
  "summary": "3 处引用，1 次降级（stale）",
  "degraded": true
}
```

## 文本输出（默认）

每条 reference 一行：`路径:行 符号(类别) — 片段首行`；降级记录
以 `⚠ 降级(code): detail` 列于末尾 summary 前；`repo.investigate.
completed` 事件走 stderr（不污染 --json 的 stdout）。

## 事件

`repo.investigate.completed`，payload：`{ question, degraded,
pathsUsed, referenceCount, durationMs }`。
