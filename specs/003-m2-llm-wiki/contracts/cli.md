# Contract: fleet wiki 命令族（M2）

**Date**: 2026-09-10 | **Spec**: [spec.md](spec.md)

退出码沿用全局约定：`0` 完成（含空结果、幂等重跑、stale 报告）、
`1` 命令自身失败（含 query 时 wiki 缺失/结构损坏）、`2` 用法错误。
目标仓库解析与 M1 一致：`--repo` > fleet.yaml `repository` > cwd
（findGitRepo）。

## 命令总览

```bash
fleet wiki init      [--repo <path>] [--json]
fleet wiki build     [--repo <path>] [--json] [--force]
fleet wiki status    [--repo <path>] [--json]
fleet wiki update    [--repo <path>] [--json]
fleet wiki query <question> [--repo <path>] [--json] [--max-hits <n>]
```

## init（US1 场景 1）

建立 `.fleet/wiki/` 骨架：index.md + 四分区（architecture / domains /
infrastructure / decisions）+ glossary.md。**幂等**：已存在的文件与
人工内容原样保留，仅补齐缺失项。输出：`{ created: string[] }`。

## build（US1 场景 2 / FR-002）

全量确定性生成（research.md D5）：每页 front matter 含
generated_from（当前 HEAD sha；非 git 仓库则整体缺失并在页面标注
missing，退出码仍 0）+ updated_at + scope；index.md 覆盖全部页面。
`--force` 跳过"未变更页面"判断直接重写（默认幂等：未变页面不动）。
写入后自动跑 Validator，错误计入输出但**不回滚**（退出码 0，错误
留给用户修复——wiki 是加速器不是关键路径）。

输出（BuildResult，见 data-model.md §4）。

## status（US3 场景 1 / FR-007）

只读报告 WikiStatus（data-model.md §3）：state（fresh/stale/unknown）、
aheadCommits、changedFiles、页面级 PageFreshness 明细、
fullRebuildRecommended。恒退出码 0。

## update（US3 场景 2-4 / FR-008/009）

增量重算：受影响判定 = D3 前缀映射；按 origin 分派——`generated`
整页重算、`mixed` 仅围栏内重写（围栏外人工内容物理保留 + 写入前
备份到 `.fleet/wiki/.backup/`）、`manual` 跳过并提示。未受影响页面
不触碰（SC-003）。输出（UpdateResult，data-model.md §4）。

## query（US2 / FR-005/006）

```bash
fleet wiki query "认证系统怎么工作？"
```

确定性检索（research.md D6）：分词 → searchPatterns 指向 wiki 根
（rg → walk 降级）→ 页面聚合排序。行为矩阵：

| wiki 状态 | 行为 | 退出码 |
|---|---|---|
| 正常 / stale | stale 时 stderr 警告，照常检索 | 0 |
| 无命中 | 空结果 + suggestions（index 页面标题全集） | 0 |
| wiki 缺失 / index 损坏 | 明确错误 + 修复指引（先 init/build） | 1 |

`--max-hits` 默认 10。`--json` 输出 WikiQueryResult（data-model
.md §6），含 scoreBreakdown（可解释排序）。

## 事件

每命令完成时发 `wiki.<cmd>.completed`（stderr，不污染 --json 的
stdout）；payload 至少含 `{ repoRoot, durationMs }` + 命令特定字段
（build/update: pagesWritten 数；query: hitCount；status: state）。

## 隔离保证（FR-010 / SC-005）

wiki 命令族只读写 `.fleet/wiki/`（update 备份写 `.fleet/wiki/.backup/`）；
不触碰源码、`.codegraph`、fleet.yaml。`.fleet` 已在 investigate 的
排除目录中（M1 既有行为，零改动）——wiki 内容不可能进入调查证据。
