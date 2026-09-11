# Quickstart: M11 Observability + Recovery 验证指南

**Spec**: [spec.md](../spec.md) | **Contract**: [contracts/observability-api.md](contracts/observability-api.md)

## 前置

```bash
pnpm build && pnpm test
```

## 场景 1 — 落盘完整性（SC-001）

tmp 仓库双任务 mission（含写任务 + 验证门）正常 run →
`.fleet/runs/<id>/<runShort>/` 八文件/目录齐全；summary 与
`--json` RunReport 数值一致；usage.json = budget 数值。

## 场景 2 — Crash 与识别（SC-002，验收锚点前半）

替身 hang 任务 run（后台）→ `kill -9 <pid>` →
`fleet ps` 显示 interrupted；`fleet status` 任务分布正确；
events.jsonl 行级合法（半行容错跳过计数）。

## 场景 3 — Resume（SC-003，验收锚点后半）

场景 2 的 mission `fleet run <path> --resume` → 已完成任务
0 重跑（events 中该任务 completed 仅出现一次）、未完任务执行、
mission completed；summary 含累计 attempts。

## 场景 4 — Cancel（SC-004）

hang 活跃 run → `fleet cancel <mission>` → cancelled 终态 +
未开始任务 skipped 落盘 + 二次 cancel 幂等提示。

## 场景 5 — 孤儿（SC-006）

手工制造孤儿 worktree + FLEET_CHILD 进程 → `fleet ps --orphans`
准确列出 → `fleet clean --force` 归零。

## 场景 6 — 指纹防漂移（SC-007）

mission 任务集改一个 id → `--resume` 拒绝（结构化 reason）。

## 成功判据（对齐 spec SC-001..007）

全部由 `tests/cli/recovery.test.ts` + observability 单元/集成
测试自动化承载。
