# Contract: CodeGraphAdapter（M1）

**Date**: 2026-09-09 | **Spec**: [spec.md](spec.md)

Fleet 对 CodeGraph 的唯一依赖面（FR-003）。消费者（investigation /
后续 M2/M3）只 import 本接口；实现可替换（真实 CLI ↔ 测试假后端，
SC-005）。

## 接口（TypeScript 形态）

```ts
interface CodeGraphAdapter {
  health(): Promise<CodeGraphHealth>
  search(query: string, limit?: number): Promise<AdapterResult<SymbolHit[]>>
  symbol(name: string): Promise<AdapterResult<SymbolHit[]>>
  callers(symbol: string): Promise<AdapterResult<SymbolEdge[]>>
  callees(symbol: string): Promise<AdapterResult<SymbolEdge[]>>
  impact(symbol: string): Promise<AdapterResult<ImpactReport>>
  explore(query: string): Promise<AdapterResult<string>>  // 原生文本
}
```

**AdapterResult**：成功 `{ ok: true, value }` / 失败
`{ ok: false, failure: CodeGraphFailure }`——**失败一律返回，不抛
异常**（FR-004），由编排层转成 FallbackReason。

**CodeGraphFailure.code**：`unavailable | timeout | error | stale`。

## CLI 映射（cli-adapter 实现约定，codegraph 1.4.1 实测）

| 能力 | CLI 调用 | 输出 |
|---|---|---|
| health | `codegraph status --json [-p <repo>]` | 直接映射（含 stale 判定，research.md D4） |
| search / symbol | `codegraph query <q> --json --limit <n> [-p <repo>]` | node[] → SymbolHit[] |
| callers / callees | `codegraph callers\|callees <sym> --json [-p <repo>]` | → SymbolEdge[] |
| impact | `codegraph impact <sym> --json [-p <repo>]` | → ImpactReport |
| explore | `codegraph explore <q> [-p <repo>]` | 文本透传 |

约定：

- 全部经 execa，`timeout: 5000`，超时 kill → `timeout` 失败。
- 命令不存在（ENOENT）→ `unavailable`；非零退出 / JSON 解析失败 →
  `error`（detail 附 stderr 首行）。
- `status.initialized === false` → health.available=true 但
  indexFresh=false（stale 语义），fixSuggestion 提示 `codegraph init`。
- **Fleet 永不调用** `init / index / sync / uninit / daemon`——索引
  是 CodeGraph 的资产（宪法 VI，research.md D4）。

## 假后端（测试）

`FakeCodeGraphAdapter` 构造参数脚本化每个方法的返回（含超时模拟：
延迟 > timeout）。行为契约与真实实现一致：失败也走 `{ ok: false }`
返回路径。
