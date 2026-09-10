# Contract: fleet repo investigate --mode（M3）

**Date**: 2026-09-10 | **Spec**: [spec.md](spec.md)

退出码沿用全局与 M1 契约：`0` 完成（含空结果、insufficient
finding、FAST 空命中）、`1` 调查自身失败、`2` 用法错误。
M1 全部选项（--repo / --json / --max-refs / --include-generated）
语义不变。

## 命令

```bash
fleet repo investigate "<question>" [--mode auto|fast|verify] [M1 既有选项]
```

| 项 | 说明 |
|----|------|
| `--mode auto` | 缺省。高风险命中 → verify，否则 fast |
| `--mode fast` | 跳过强制源码锚定（verified=false、confidence ≤ medium）；高风险仍强制 verify（FR-005） |
| `--mode verify` | 全链：wiki（fresh）→ codegraph → search → source + config 复核 |

## JSON 输出（M1 字段之上的增量）

```json
{
  "question": "PaymentService 删除会影响哪里",
  "references": [ /* M1 Reference，原样 */ ],
  "pathsUsed": ["wiki", "codegraph", "search", "source", "config"],
  "fallbacks": [
    { "code": "wiki_stale", "detail": "wiki 锚点落后 HEAD 3 提交，未使用" }
  ],
  "mode": {
    "requestedMode": "auto",
    "effectiveMode": "verify",
    "escalations": [
      { "rule": "high_risk", "detail": "命中高风险表：Payment + 删除类动词" }
    ]
  },
  "findings": [
    {
      "kind": "symbol",
      "statement": "「PaymentService」共 3 处引用，定义于 src/payment.ts:8",
      "evidence": [
        {
          "source": "source",
          "location": "src/payment.ts:8",
          "excerpt": "export class PaymentService {",
          "verified": true,
          "symbol": "PaymentService"
        },
        {
          "source": "config",
          "location": "config/rates.yaml:2",
          "excerpt": "max_charge: 500",
          "verified": true
        }
      ],
      "confidence": "high",
      "confidenceReason": "verified 多源一致（source+config），无未决冲突",
      "conflicts": [],
      "truncated": false
    }
  ],
  "durationMs": 612,
  "summary": "1 条结论（high），4 处引用，1 次降级（wiki_stale） · 612ms",
  "degraded": true
}
```

## 文本输出（默认）

M1 引用列表之后追加 findings 段：每条 finding 一行
`[confidence] statement` + 缩进的证据来源计数
（`source×2 config×1 wiki×1`）；conflicts 以
`⚠ 冲突(kind)：加速源称 X，源码事实 Y（static_truth 胜出）`
列出；mode 升级以 `↗ 模式升级(rule)：detail` 列于降级记录区。

## 事件

`repo.investigate.completed` payload 扩展（可选字段，M1 断言
不受影响）：`{ ..., findingsCount, effectiveMode, confidence }`。

## 隔离保证（SC-004，宪法 I）

wiki 只读且三态降级（missing / stale / broken 仅记 FallbackReason）；
整删 `.fleet/wiki` 后 investigate 成功率与退出码不变、输出无 wiki
路径残留——集成后的回归测试钉死该语义。
