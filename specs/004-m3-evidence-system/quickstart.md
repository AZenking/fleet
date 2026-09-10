# Quickstart: M3 Evidence System 验证指南

**Date**: 2026-09-10 | **Spec**: [spec.md](spec.md)

命令契约见 [contracts/cli.md](contracts/cli.md)，数据结构与规则表见
[data-model.md](data-model.md)。本仓库 wiki 已建（M2 交付）。

## 前置条件

- M0–M2 基线可用（`pnpm check` 全绿）
- wiki 已构建且新鲜：`pnpm fleet wiki build --repo .`
- codegraph 状态任意（健康 → 走加速；stale/缺失 → 自动降级，
  两者都是有效演示）

## A. 结论带证据（US1 / SC-001 / SC-003）

```bash
pnpm fleet repo investigate "FleetError 在哪里定义" --repo . --json
```

**预期**：

- 输出含 `findings`：statement 可读（如「FleetError」共 N 处引用，
  定义于 …），evidence 至少一条 `source` 证据 `verified: true`。
- **SC-001 抽查**：打开任意 `verified: true` 证据的 location——
  文件与行内容真实存在；wiki 证据（若有）页面真实存在。
- **SC-003 复现**：重复执行同一命令，两次 `findings` 的
  statement / confidence / confidenceReason 完全一致。
- M1 字段（references / fallbacks / summary）原样保留。

## B. FAST / VERIFY 模式（US2 / SC-002 / SC-006）

```bash
pnpm fleet repo investigate "loadFleetConfig" --repo . --mode fast --json
pnpm fleet repo investigate "loadFleetConfig" --repo . --mode verify --json
```

**预期**：

- fast：`effectiveMode: "fast"`，codegraph 证据 `verified: false`，
  confidence ≤ medium；verify：含 `source` 复核层（verified: true）。
- fast 耗时 ≤ verify（SC-006），且 ≤ 10s。

**高风险矩阵（SC-002，六类）**——默认与显式 fast 双调用：

| # | 问题示例 | 预期 |
|---|---------|------|
| 1 | "删除 PaymentService 会影响哪些调用方" | effectiveMode=verify + high_risk 升级记录 |
| 2 | "认证 login 流程怎么走" | 同上（Authentication 规则） |
| 3 | "支付 charge 逻辑在哪" | 同上（Payment 规则） |
| 4 | "DB schema 迁移在哪定义" | 同上（DB Schema 规则） |
| 5 | "public API 导出了什么" | 同上（公共 API 规则） |
| 6 | "大范围重构 refactor 的入口" | 同上（Refactor 规则） |

自动化等价物：`tests/cli/investigate-evidence.test.ts` 覆盖同一
矩阵（默认 + 显式 fast 双调用断言）——**测试即验收证据**。

## C. Wiki 接入与隔离（US3 / SC-004）

```bash
# 1) wiki 参与调查
pnpm fleet repo investigate "调查链路在哪个包" --repo . --json
# 预期：findings 含 wiki 证据（location 为 wiki 页面路径）

# 2) 三态降级
rm -rf .fleet/wiki
pnpm fleet repo investigate "FleetError" --repo . --json
# 预期：fallbacks 含 wiki_missing；调查成功退出码 0；pathsUsed 无 wiki

# 3) stale 态：重建后制造一次提交
pnpm fleet wiki build --repo . && git commit --allow-empty -m "drift"
pnpm fleet repo investigate "FleetError" --repo . --json
# 预期：fallbacks 含 wiki_stale（过期知识不使用）；git reset HEAD~ 恢复
```

**SC-004 硬断言**（自动化）：整删 wiki 前后 investigate 的
references/退出码一致——`tests/cli/investigate-evidence.test.ts`。

## D. 冲突裁决（US3 / SC-005）

手工构造（夹具仓库，自动化覆盖）：

1. **锚点偏移**：FakeCodeGraphAdapter 返回偏移行号 → finding 附
   `EvidenceConflict{kind: anchor_offset}`，胜出方 static_truth，
   最终 location 为源码真实位置。
2. **wiki 死路径**：wiki 页面围栏内写一个不存在的路径
   `packages/ghost/src/x.ts` 并 build → 调查命中该页 →
   `EvidenceConflict{kind: dead_path}`。

```bash
pnpm vitest run --project repository src/evidence
pnpm vitest run --project cli-e2e tests/cli/investigate-evidence.test.ts
```

## 完成判定

以上全部通过 = M3 验收（roadmap M3：每个关键 Finding 可追踪到
Wiki / CodeGraph / Source / Config 等 Evidence），同时 **Phase A
收官——Repository Intelligence 0.1 release gate 达成**。
