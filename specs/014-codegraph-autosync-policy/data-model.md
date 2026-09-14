# Data Model: CodeGraph 索引自动维护策略

**Date**: 2026-09-14 | **Spec**: [spec.md](../spec.md)

## 1. MaintainPolicy

`'manual' | 'sync' | 'auto'`——manual（缺省）= 现状零维护；
sync = stale→自动 codegraph sync；auto = 额外 uninitialized→
codegraph init。

## 2. CodeGraphMaintainer（接口，packages/repository/codegraph）

```ts
interface MaintainOptions { timeoutMs: number }
type MaintainOutcome =
  | { ok: true; durationMs: number }
  | { ok: false; kind: 'failed' | 'timeout'; detail: string; durationMs: number };

interface CodeGraphMaintainer {
  init(options: MaintainOptions): Promise<MaintainOutcome>;
  sync(options: MaintainOptions): Promise<MaintainOutcome>;
}
```

- **CliCodeGraphMaintainer**：execa `codegraph init|sync`（cwd=
  repoRoot；超时 kill；非零退出/启动失败 → failed）。
- **FakeCodeGraphMaintainer**：脚本队列（按调用序出队 outcome，
  耗尽重复末项）+ `calls` 记录（action/timeoutMs）——测试面。

## 3. InvestigateOptions 扩展

```ts
codegraph?: {
  policy: MaintainPolicy;         // 缺省 manual（不传该段 = manual）
  timeoutMs?: number;             // 维护超时（缺省 300_000）
  maintainer?: CodeGraphMaintainer; // 注入面（缺省 Cli 实现按需构造）
}
```

## 4. 维护状态机（investigate 健康检查处）

```text
health 检查
 ├─ unavailable → 降级（任何档零维护）【现状】
 ├─ uninitialized
 │    ├─ policy=auto → init（单次）→ 重查 → fresh 则用 / 否则降级
 │    └─ manual|sync → 降级（fixSuggestion 提示 auto 档）【现状+文案】
 └─ stale
      ├─ policy=sync|auto → sync（单次）→ 重查 → fresh 则用 / 否则降级
      └─ manual → 降级【现状】
维护执行：started 事件 → maintainer → completed/failed 事件
  （超时按 failed+timeout 记）
fallback detail：维护尝试后附加"已尝试自动 <action>：<结果>"
```

重查恰一次；无循环。

## 5. 维护事件（M11 事件流扩展）

| type | payload |
|---|---|
| `codegraph.init.started` / `codegraph.sync.started` | { action, policy } |
| `codegraph.init.completed` / `codegraph.sync.completed` | { action, policy, durationMs } |
| `codegraph.init.failed` / `codegraph.sync.failed` | { action, policy, kind: failed|timeout, durationMs, detail } |

## 6. 配置（core config schema 扩展）

```yaml
# configs/fleet.yaml
version: 1
codegraph:
  autoMaintain: sync   # manual | sync | auto（缺省 manual）
  timeoutMs: 300000    # 可选
```

strictObject 校验；非法值拒绝（CONFIG_INVALID 语义沿用）。
优先级：CLI 旗标 > fleet.yaml > 缺省 manual。
