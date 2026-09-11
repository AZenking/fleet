# Quickstart: M7 五角色 Agent + 真实 Runtime 验证指南

**Date**: 2026-09-11 | **Spec**: [spec.md](../spec.md)

契约见 [contracts/agents-policy.md](contracts/agents-policy.md) /
[contracts/cli.md](contracts/cli.md)。

## 前置条件

- M0–M6 基线可用（`pnpm check` 全绿）
- 本机探测：`pi` 已装（0.85.1）；codex / gemini 未装——对应
  真实 e2e 自动跳过，不阻塞验收

## A. 五角色与替换自由度（US1 / SC-001）

```bash
pnpm vitest run --project agents   # 角色定义/矩阵/注册表/执行器单元
```

**预期**：五角色权限矩阵逐项断言（宪法 II）；注册表缺省 fake /
单角色覆盖 / 多对一 / 未注册报错；同一 mission 在两种注册下
Scheduler 与 bridge 代码零改动（替换自由度的结构断言）。

```bash
# 手工感受替换：全 fake vs 单角色覆盖（pi 缺席机器用替身，见 D）
pnpm fleet run missions/demo.yaml                          # 全 fake
pnpm fleet run missions/demo.yaml --runtime reason=pi      # reason→pi 其余 fake
```

## B. 真实适配器矩阵（US2 / SC-003 / SC-006）

```bash
pnpm vitest run --project runtime src/cli-adapter.test.ts
```

替身脚本（受控 PATH）驱动 CliRuntimeAdapter 全矩阵：成功 /
非零退出（exit+stderr 摘要）/ 超时 kill / cancel 毫秒级 /
**进程组无孤儿**（pid 文件轮询断言）/ 输出截断 64KB / 裸请求
拒绝（不启子进程）/ stdin ignore。M6 四条款 100% 复测。

## C. 权限强制（US3 / SC-002）

```bash
pnpm vitest run --project agents src/policy.test.ts
```

**预期**：只读角色（focus/insight/wisdom）请求不含写授权
100%；reflex=LIGHT_WRITE / reason=DEEP_WRITE；裸请求被适配器
（含 Fake）拒绝 100%。

## D. 端到端（SC-004 / SC-005）

```bash
# 替身运行时 e2e（确定性，任何机器恒绿）
pnpm vitest run --project cli-e2e tests/cli/runtime-adapters.test.ts

# 真实 pi e2e（探测启用；未装自动 skip）
# 单任务 mission 以 reason=pi 跑通，断言 prompt 与权限段到达 CLI
```

手工（本机有 pi）：

```bash
pnpm fleet run missions/demo.yaml --runtime reason=pi   # 真实子进程执行
fleet doctor                                             # Agent Runtime 探测行
```

**预期**：pi 子进程真实执行（任务表行标 `[pi · DEEP_WRITE]`）；
doctor 列出 pi 可用 + codex/gemini 未装建议。

## E. 不静默降级（FR-007）

```bash
pnpm fleet run missions/demo.yaml --runtime codex   # 本机未装
```

**预期**：退出码 1，输出"codex 未安装 + 安装建议"，**不出现
任何 fake 执行**（零请求发出）。

## 完成判定

以上全部通过 = M7 验收（roadmap：**同一 Agent Role 可替换
Runtime 而无需修改 Scheduler / Core**；权限由 Runtime/Tool
Policy 层强制）。
