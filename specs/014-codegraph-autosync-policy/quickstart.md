# Quickstart: CodeGraph 索引自动维护策略验证指南

**Spec**: [spec.md](spec.md) | **Contract**: [contracts/maintainer-api.md](contracts/maintainer-api.md)

## 前置

```bash
pnpm build && pnpm test
```

## 场景 1 — 三档矩阵（SC-001，单测承载）

Fake adapter + Fake maintainer（脚本队列）+ FakeCodeGraphAdapter
.setHealth：manual 零调用零变化 / sync 档 stale→恰一次 sync→重查
fresh→pathsUsed 含 codegraph / auto 档 uninitialized→恰一次 init
→命中。事件断言（started+completed 各一）。

## 场景 2 — 故障三态（SC-002/003）

sync 档 + Fake maintainer 出队 {failed} / {timeout} / 维护成功但
setHealth 仍 stale：三态全部降级完成调查、fallback 含"已尝试自动
sync：<结果>"、维护动作事件总数恰 1。

## 场景 3 — unavailable 零维护（SC-005）

health.available=false × 三档：maintainer.calls 长度 0。

## 场景 4 — 配置与旗标（真机）

```bash
# configs/fleet.yaml
codegraph: { autoMaintain: sync }

fleet repo investigate "ValidationRunner 在哪被调用"   # 走策略
fleet repo investigate "..." --codegraph-maintain manual # 单次覆盖
fleet logs <mission> | grep codegraph.sync               # 事件可查（run 场景）
```

## 场景 5 — 默认零变化（SC-004）

全量既有测试绿（manual 缺省路径逐字节现状）。

## 成功判据（对齐 spec SC-001..005）

全部由 investigate.test.ts 新增矩阵 + 全量回归自动化承载。
