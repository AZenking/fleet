# Quickstart: M4 Core Domain 验证指南

**Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

命令契约见 [contracts/cli.md](contracts/cli.md)，文件格式与错误
语义见 [contracts/mission-file.md](contracts/mission-file.md)。

## 前置条件

- M0–M3 基线可用（`pnpm check` 全绿）
- 仓库已有 `missions/demo.yaml`（活样例，本里程碑交付物之一）

## A. 合法路径（US1 / SC-001）

```bash
pnpm build
pnpm fleet mission validate missions/demo.yaml          # 文本摘要
pnpm fleet mission validate missions/demo.yaml --json   # 结构化
```

**预期**：

- 退出码 0；摘要含 id / goal / planningMode / 任务数 / 验收数 /
  约束数；耗时 < 1s（SC-001）。
- stderr 含 `mission.validated` 事件。
- 重复执行两次输出逐字节一致（SC-004）。

## B. 故障注入矩阵（SC-002 / SC-003，自动化主证据）

```bash
pnpm vitest run --project cli-e2e tests/cli/mission.test.ts
```

矩阵 10 类（每类一个 tmp 文件，断言退出码 1 + issues 含正确字段
路径；多错误文件断言一次报全）：

| # | 注入 | 预期 path |
|---|------|-----------|
| 1 | 删 `goal` | `goal`（required） |
| 2 | `acceptance: []` | `acceptance`（min 1） |
| 3 | `planningMode: Execution` | `planningMode`（枚举 + 大小写） |
| 4 | execution 删 `plan` | `plan`（语义层：execution 要求） |
| 5 | 两个任务同 id | `tasks.1.id`（重复 + 双位置） |
| 6 | `agentRole: coder` | `tasks.0.agentRole`（五角色枚举） |
| 7 | `dependsOn: [ghost]` | `tasks.0.dependsOn`（悬空） |
| 8 | 任务依赖自身 | `tasks.0.dependsOn`（自环） |
| 9 | 顶层未知字段 / `acceptences` 拼错 | 未知字段逐条 |
| 10 | `maxTokens: -5` | `constraints.0.value`（非负） |

文件级故障另测：路径不存在 / 传目录 / 二进制文件 / 多文档 YAML
——均退出码 1 + 明确信息，0 崩溃。

## C. planningMode 语义（US2）

```bash
# autonomous：只有 requirements 也合法（Reason 规划是 M7 范围）
cat > /tmp/auto.yaml <<'EOF'
id: auto-demo
goal: 探索性任务
planningMode: autonomous
requirements:
  - text: 调研 X 方案
acceptance:
  - given: 无
    when: 完成调研
    then: 产出对比结论
EOF
pnpm fleet mission validate /tmp/auto.yaml     # 预期通过
```

同一文件把 planningMode 改成 execution → 报"execution 模式要求
plan 与非空 tasks"（错误信息自解释，US2 场景 2）。

## D. 错误自解释走查（SC-005）

把矩阵 #7（悬空依赖）的错误输出原样展示，**不看源码**，仅凭
`[tasks.0.dependsOn] 期望 引用存在的 task id，实际 ghost` 修好
文件——任何一类故障都可如此修复即达标。

## 完成判定

以上全部通过 = M4 验收（roadmap M4：Schema / Constraint /
Acceptance / planningMode 验证完整，错误信息清晰）。
