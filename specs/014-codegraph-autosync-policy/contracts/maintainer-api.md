# Contract: CodeGraphMaintainer + 策略接线

**Spec**: [../spec.md](../spec.md) | **Data Model**: [../data-model.md](../data-model.md)

## 1. CodeGraphMaintainer（写接缝——唯一入口）

```ts
// packages/repository/src/codegraph/maintainer.ts
class CliCodeGraphMaintainer {
  constructor(options: { repoRoot: string; command?: string });
  init(options: { timeoutMs: number }): Promise<MaintainOutcome>;
  sync(options: { timeoutMs: number }): Promise<MaintainOutcome>;
}
```

**合同条款**：

1. **只经用户策略授权调用**——组件自身不做任何策略判断（判断
   属 investigate；本组件是纯执行器）。
2. **子进程封装现成 CLI**（宪法 VI）：`codegraph init` /
   `codegraph sync`，cwd = repoRoot，超时 kill 按超时处理。
3. **异常不逃逸**：启动失败/非零退出/超时 → 结构化
   MaintainOutcome（ok:false），永不 throw。
4. **cli-adapter.ts 红线不变**：只读 adapter 不 import 本组件、
   不新增写方法——写路径唯一入口是本契约。

## 2. investigate 接线

```ts
// InvestigateOptions 增（缺省不传 = manual 现状）
codegraph?: {
  policy: 'manual' | 'sync' | 'auto';
  timeoutMs?: number;              // 缺省 300_000
  maintainer?: CodeGraphMaintainer; // 测试注入（缺省 Cli 实现惰性构造）
}
```

**状态机**（见 data-model §4）：单次维护 → 恰一次重查 → 事件
（§3）→ fallback detail 附尝试信息。**降级链代码路径零改动**
（维护只发生在"是否给 codegraphUsable 置真"的判定前）。

## 3. 事件

`codegraph.{init,sync}.started/completed/failed`（payload 见
data-model §5）经既有 `emitEvent`——M11 观测面无新通道。

## 4. 配置与旗标

- fleet.yaml：`codegraph: { autoMaintain, timeoutMs? }`
  （strictObject；缺省 manual/300000）。
- CLI：`fleet repo investigate <q> [--codegraph-maintain manual|sync|auto]`
  （旗标 > 配置 > 缺省）。
- MCP `repo_investigate`：读目标仓库 configs/fleet.yaml（缺文件
  = manual）注入同语义。

## 5. 测试替身

- `FakeCodeGraphMaintainer`（同文件导出）：`script` 队列 +
  `calls` 记录。
- `FakeCodeGraphAdapter.setHealth(next)`：维护成功后测试改写
  健康态，驱动"重查命中"。
