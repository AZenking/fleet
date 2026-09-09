# Quickstart: M1 CodeGraph + Fallback 验证指南

**Date**: 2026-09-09 | **Spec**: [spec.md](spec.md)

命令契约见 [contracts/cli.md](contracts/cli.md)，数据结构与降级码见
[data-model.md](data-model.md)。

## 前置条件

- M0 基线可用（`pnpm check` 全绿）
- 目标仓库已建索引：`codegraph init`（本仓库已建，实测 138ms）

## 健康路径（US1 / SC-001 / SC-004）

```bash
pnpm build
pnpm fleet repo investigate "FleetError 在哪里被抛出"     # 文本
pnpm fleet repo investigate "loadFleetConfig" --json      # 纯符号名
```

**预期**：

- 返回 references，`pathsUsed` 含 `codegraph`；抽样打开任一
  `filePath:startLine`，代码确实存在（SC-004 锚点 100%）。
- `--json` 可解析，退出码 0；stderr 含 `repo.investigate.completed`。
- 健康路径耗时 ≤ 10s（SC-001）。

## 故障注入矩阵（US2 / SC-002 / SC-003）

| # | 场景 | 手工操作 | 预期 |
|---|------|---------|------|
| 1 | 不可用 | 受控 PATH 下运行（前置空 bin 目录），或卸载 codegraph | fallbacks 含 `unavailable`，走 search/source，退出码 0 |
| 2 | 超时 | 假后端注入（自动化测试），或临时调小预算 | `timeout` 降级，总耗时不失控 |
| 3 | stale | `touch packages/core/src/config/loader.ts`（不 sync）后再调查 | `stale` 降级 + 建议 `codegraph sync`，结果仍返回 |
| 4 | 缺 symbol | 查询不存在的符号名 | `missing_symbol` → search 兜底 |
| 5 | 同名歧义 | 查询夹具仓库中的同名符号对 | `ambiguous`，references 列出全部候选 |
| 6 | 空结果 | 查询无关词 | 空 references + 明确"未找到"，退出码 0 |
| 7 | 与源码冲突 | 假后端返回偏移的行号（自动化测试） | `conflict`，以源码为准 |
| 8 | 高风险模式 | 查询夹具中配置驱动的行为 | 即使 codegraph 命中也 `high_risk` 升级源码复核 |

场景 1/3/4/6 可手工执行；2/5/7/8 由自动化测试覆盖（假后端 + 夹具
仓库，research.md D6）——测试即验收证据。

## 适配层替换验证（US3 / SC-005）

自动化：`FakeCodeGraphAdapter` 与真实 CLI 驱动同一套 investigate
编排，断言消费者代码零改动（`pnpm test` 内覆盖）。

## 兜底链尽头（spec US2 场景 4）

```bash
PATH=/usr/bin:/bin pnpm fleet repo investigate "FleetError" --repo .
```

（rg 与 codegraph 均不在受控 PATH 时）→ search 标注
`engine=walk` 降级为内置遍历，仍返回结果、退出码 0。

## 完成判定

以上全部通过 = M1 验收（roadmap M1：CodeGraph 故障时自动
`Search → Source → Result`，调查不因 CodeGraph 不可用直接失败）。
