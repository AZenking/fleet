# Quickstart: M9 Validation + Review Loop 验证指南

**Spec**: [spec.md](spec.md) | **Contract**: [contracts/validation-api.md](contracts/validation-api.md)

证明 M9 端到端可用的最小操作序列。全程 tmp git 仓库，不触碰
本仓库工作区。

## 前置

```bash
pnpm build          # 全 workspace 构建（含新 @fleet/validation）
pnpm test           # 单元 + 集成 + e2e（validation.test.ts 即本里程碑验收）
```

## 场景 1 — 验证门通过路径（SC-004 正侧）

tmp 仓库 + 替身：

```text
repo/
├── .gitignore               # .fleet/
├── base.txt                 # 基线提交
├── checks/lint.sh           # exit 0
├── checks/tests.sh          # exit 0
└── mission.yaml             # 见下
```

```yaml
id: v9-pass
goal: 验证门通过路径
planningMode: execution
requirements: [{ text: 需求 }]
plan: { summary: 方案 }
tasks:
  - id: impl-a
    goal: 实现 A
    agentRole: reason
validation:
  commands: { lint: ./checks/lint.sh, tests: ./checks/tests.sh }
acceptance: [{ given: 无, when: 执行, then: 完成 }]
```

```bash
PATH=tests/fixtures/fake-clis:$PATH fleet run mission.yaml \
  --runtime reason=write-cli --runtime wisdom=review-approved-cli
```

**预期**：任务 completed；主分支含 write-cli 写入的文件
（merged）；报告 `reviews[0].terminal === 'approved'`、
`rounds === 0`；`workspaces[0].action === 'merged'`。

## 场景 2 — M9 验收锚点（SC-001：自报不算证据）

同上，但 `checks/tests.sh` 改为 `exit 1`，且 write-cli 的
stdout 印 `tests passed`（实现者自报）：

```bash
... fleet run mission.yaml --runtime reason=write-cli \
    --runtime wisdom=review-approved-cli   # 审阅者本会批准
```

**预期**：任务 **failed**（`review_exceeded`）——尽管实现者自报
"tests passed" 且 Wisdom 愿意批准，验收判定只取
ValidationArtifact（tests=fail）。主分支**零合并**。锚点原文
"Reason / Reflex 自报'测试通过'不能作为 Mission Acceptance"的
操作化。

## 场景 3 — 审阅循环三路径（SC-003）

替身：`review-reject-cli`（印 `changes_requested`）+
`review-approved-cli`；mission `maxReviewLoops: 2`。

| 路径 | 替身序列（wisdom） | 预期 |
|---|---|---|
| 一次通过 | approved | terminal=approved，rounds=0 |
| 一轮修复后通过 | reject → approved | terminal=approved，rounds=1，artifacts 长 2 |
| 超限 | reject × N | 第 2 轮修复后仍 reject → terminal=review_exceeded，rounds=2，**无第 3 轮修复发起**（reviews/事件计数断言） |

> 序列注入：e2e 用"同名脚本按调用计数翻转输出"的替身 CLI；
> 库级测试用 Fake `script: { 'impl-a-review': [...] }` 出队语义。

## 场景 4 — 逃生口

```bash
fleet run mission.yaml --no-validation-gate   # M8 auto：成功即合（无验证/审阅）
fleet run mission.yaml --no-worktree          # M7 直通（无隔离区即无门）
```

## 库级最小用法

```ts
import { FakeRuntimeAdapter } from '@fleet/runtime';
import { GitWorktreeManager } from '@fleet/workspace';
import {
  AgentReviewer,
  ValidationReviewGate,
  ValidationRunner,
  resolveValidationProfile,
} from '@fleet/validation';

const manager = new GitWorktreeManager(repoRoot);
const gate = new ValidationReviewGate({
  runner: new ValidationRunner(),
  reviewer: new AgentReviewer({ adapter: reviewFake, repoRoot }),
  manager,
  profile: resolveValidationProfile(mission, repoRoot),
  repoRoot,
  emitEvent: (e) => events.push(e),
});
// new WorkspaceResolvingExecutor({ ..., gate }) → fleet run 同构
```

**判定断言点**：`gate.packages[0].terminal / rounds / artifacts /
verdicts`；事件序列 `task.validation.* → task.review.*`（SC-005
重放：serializeEvent → deserializeEvent round-trip）。

## 成功判据（对齐 spec SC-001..006）

- [ ] SC-001 自报矛盾：判定 100% 取 Artifact，自报零影响
- [ ] SC-002 状态矩阵：pass/fail/skipped/timeout × 四检查结构化
- [ ] SC-003 三路径全绿 + 上限强制（无第 3 轮）
- [ ] SC-004 零 merge（git 断言）+ 通过者 merged
- [ ] SC-005 事件完备可重放
- [ ] SC-006 ReviewPackage 三终态可得
