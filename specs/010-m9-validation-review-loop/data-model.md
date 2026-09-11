# Data Model: M9 Validation + Review Loop

**Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

结构定义于 `packages/validation/src/types.ts`（实体）与
`packages/workspace/src/types.ts`（gate 端口）；契约细节见
[contracts/validation-api.md](contracts/validation-api.md)。复用：
M8 Workspace/WorkspaceManager、M7 RuntimeRequest/RuntimeResult、
core createId（`art_` 前缀）、mission schema 扩展字段。

## 1. ValidationCheck

| 字段 | 类型 | 规则 |
|---|---|---|
| `kind` | `'diff' \| 'lint' \| 'typecheck' \| 'tests'` | diff 不可配置，其余可 |
| `command` | string \| undefined | 实际执行命令（diff = 内建 git 语义则 undefined） |
| `status` | `'pass' \| 'fail' \| 'skipped' \| 'timeout'` | timeout 按 fail 计入整体 |
| `exitCode` | number \| undefined | 子进程退出码（命令执行时必有） |
| `outputExcerpt` | string | 头 2KB + 尾 2KB 截断 + 标注 |
| `durationMs` | number | 单检查耗时 |
| `evidence` | string | 证据类型（diff→config、lint/typecheck→runtime、tests→test） |
| `skipReason` | string \| undefined | skipped 时必有（`empty-diff` / `not-configured`） |
| `required` | boolean | 显式配置 = true；探测到 = true；未探测到 = false |

## 2. ValidationArtifact

| 字段 | 类型 | 规则 |
|---|---|---|
| `id` | string | `art_` 前缀 + UUID（core createId） |
| `taskId` / `runId` | string | 归属（runId 缺省 `adhoc`） |
| `workspaceRef` | string | worktree 路径（追溯锚点） |
| `loop` | number | 当前轮次序号（首跑 = 0，每修复 +1） |
| `checks` | ValidationCheck[] | 固定顺序 diff → lint → typecheck → tests |
| `overall` | `'pass' \| 'fail' \| 'noop'` | noop ⟺ diff 空；任一 required 检查 fail/timeout → fail |
| `diffStat` | `{ files, insertions, deletions }` | 变更面统计（ReviewPackage 引用） |
| `createdAt` | string | ISO 8601 |

## 3. ValidationProfile（解析结果，非持久实体）

| 字段 | 类型 | 规则 |
|---|---|---|
| `checks` | `Record<'lint'\|'typecheck'\|'tests', { command?: string; required: boolean }>` | mission 显式 → required=true；探测到 → required=true；否则 command 缺失 required=false |
| `timeoutMs` | number | 单命令超时（默认 300_000；mission `validation.timeoutMs` 覆盖） |
| `maxReviewLoops` | number | 修复轮次上限（默认 2；mission `maxReviewLoops` 覆盖；0 = 纯验证门） |

解析链（D5）：mission.validation.commands → worktree 内
package.json scripts（包管理器按 lockfile 识别）→ skipped。

## 4. ReviewVerdict / 审阅结果

| 字段 | 类型 | 规则 |
|---|---|---|
| `verdict` | `'approved' \| 'changes_requested'` | 二值裁决 |
| `comments` | string | 审阅意见（修复上下文 / 报告展示） |
| `loop` | number | 对应验证轮次 |

审阅失败（适配器失败 / 输出不可解析）不是 Verdict——是
`ReviewFailure { code, detail }`，fail-closed 直达任务失败。

## 5. ReviewPackage（任务终态汇总，进 RunReport.reviews）

| 字段 | 类型 | 规则 |
|---|---|---|
| `taskId` | string | 归属任务 |
| `terminal` | `'approved' \| 'review_exceeded' \| 'review_error'` | 终态（fix/执行失败不经 gate 汇总——M5 语义） |
| `rounds` | number | 消耗修复轮次 |
| `maxReviewLoops` | number | 本任务生效上限 |
| `artifacts` | ValidationArtifact[] | 全轮次（loop 0..n） |
| `verdicts` | ReviewVerdict[] | 全轮次审阅（纯验证门为空） |
| `diffStat` | `{ files, insertions, deletions }` | 末轮变更面（引用语义，不内联全文） |
| `disposition` | string | 处置结论（merged / destroyed / kept / conflict） |

## 6. WorkspaceGate（端口，@fleet/workspace）

```ts
interface GateEvaluation {
  task: Task;
  workspace: Workspace;
  execution: { ok: boolean; detail?: string };   // 首跑实现结果
  reexecute: (feedback: string) => Promise<{ ok: boolean; detail?: string }>;
}
interface GateDecision {
  pass: boolean;
  outcome: 'approved' | 'review_exceeded' | 'review_error' | 'fix_failed';
  detail?: string;
  retryable?: boolean;   // review_exceeded / review_error 携带 false
}
interface WorkspaceGate {
  evaluate(evaluation: GateEvaluation): Promise<GateDecision>;
  readonly packages: ReviewPackageLike[];   // 报告面（结构化代理）
}
```

## 7. 状态机（gate 编排，D2 不变式）

```text
execute(impl) ──fail──→ fix_failed（M5 retry 语义，可重试）
      │ok
      ▼
┌─ loop L: validate ──fail──→ rounds < max? ──no──→ review_exceeded(终态)
│      │pass/noop                │yes
│      ▼                         ▼
│   maxReviewLoops == 0?      reexecute(验证失败摘要)
│      │yes → approved         rounds+1, L+1 ↺
│      │no
│      ▼
│   review ──approved──→ approved（→ merge）
│      │changes_requested
│      ▼
│   rounds < max? ──no──→ review_exceeded(终态)
│      │yes → reexecute(审阅意见)，rounds+1, L+1 ↺
└─ review 适配器/解析失败 → review_error（fail-closed，终态）
```

不变式：`rounds ≤ maxReviewLoops`（结构性——上限检查先于修复
发起）；审阅次数 ≤ 修复次数 + 1；无第 maxReviewLoops+1 轮修复。

## 8. 事件类型（validation 包自有，注入 emitter）

| type | 关键 payload |
|---|---|
| `task.validation.started` | runId, taskId, loop |
| `task.validation.completed` | runId, taskId, loop, overall, checks: [{kind,status}] |
| `task.review.started` | runId, taskId, loop |
| `task.review.completed` | runId, taskId, loop, verdict |
| `task.review.exceeded` | runId, taskId, maxReviewLoops, rounds |

FleetEvent.type 命名空间合法（`^[a-z0-9]+(\.[a-z0-9-]+)+$`）；
序列化经 core serializeEvent（SC-005 round-trip）。

## 9. mission schema 扩展（@fleet/mission，可选字段）

```ts
validation?: {
  commands?: { lint?: string; typecheck?: string; tests?: string };
  timeoutMs?: number;          // int > 0
};
maxReviewLoops?: number;        // int ≥ 0（缺省 2 于运行时解析）
```

strictObject + 可选字段：既有 mission 全部兼容；语义校验
（timeoutMs 正整数等）沿既有 Zod 约束。
