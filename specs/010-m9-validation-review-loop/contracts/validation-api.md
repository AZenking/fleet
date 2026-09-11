# Contract: @fleet/validation 公共 API

**Spec**: [../spec.md](../spec.md) | **Data Model**: [../data-model.md](../data-model.md)

实现方合同条款（对应 FR-001..013；违反任何一条 = 契约破坏）。

## 1. ValidationRunner

```ts
interface ValidationRunner {
  validate(input: ValidationInput): Promise<ValidationArtifact>;
}
interface ValidationInput {
  task: Task;
  workspace: Workspace;      // M8 实体（diff 与 cwd 来源）
  loop: number;              // 首跑 0，修复 +1
  runId?: string;            // 缺省 'adhoc'
}
```

**合同条款**：

1. **独立执行**：validate 在 Fleet 进程内以子进程方式运行检查
   命令（cwd = workspace.path）；不读取、不接受实现者的任何
   输出 / 会话 / 自报（宪法 III——SC-001 的判定路径断言点）。
2. **顺序确定**：checks 固定顺序 diff → lint → typecheck →
   tests；不短路（fail 也继续后续检查——矩阵完整、修复上下文
   证据齐全）。
3. **超时诚实**：每命令受 profile.timeoutMs 约束；超时 →
   status=timeout（按 fail 计入 overall），含已运行时长，无
   悬挂进程（kill 后回收）。
4. **输出截断**：outputExcerpt = 头 2KB + 尾 2KB + 截断标注；
   二进制 / 空输出原样标注。
5. **noop 语义**：diff 为空 → 其余检查 skipped（skipReason=
   empty-diff）、overall=noop（不算失败——由审阅定性）。
6. **主仓零写入**：全部检查只写 worktree（检查命令自身副作用
   不回退、不清理）；diff 经 M8 getDiff（intent-to-add 语义）。

## 2. ValidationProfile 解析

```ts
resolveValidationProfile(mission: Mission, workspacePath: string): ValidationProfile;
```

- mission.validation.commands[k] 显式配置 → `{command, required: true}`
- 否则探测 workspacePath 的 package.json：`scripts.lint` →
  `<pm> run lint`；`scripts.typecheck` → `<pm> run typecheck`；
  `scripts.test` → `<pm> test`（探测到 → required: true）
- 否则 → `{command: undefined, required: false}`（运行时记
  skipped，skipReason=not-configured）
- `<pm>`：pnpm-lock.yaml → pnpm；yarn.lock → yarn；否则 npm
- timeoutMs：mission.validation.timeoutMs ?? 300_000
- maxReviewLoops：mission.maxReviewLoops ?? 2

## 3. AgentReviewer

```ts
interface Reviewer {
  review(request: ReviewRequest): Promise<ReviewOutcome>;
}
interface ReviewRequest {
  mission: Mission;
  taskId: string;
  loop: number;
  artifact: ValidationArtifact;
  diffExcerpt: string;        // 头 8KB + diffStat
  priorFeedback?: string;     // 前轮意见（首轮缺省）
}
type ReviewOutcome =
  | { ok: true; verdict: ReviewVerdict }
  | { ok: false; code: string; detail: string };   // 审阅错误
```

**合同条款**：

1. **经 RuntimeAdapter**（宪法 IV 单一接缝）：构造
   RuntimeRequest——agentId = `agent:<taskId>-review`（Fake 脚本
   键约定）、cwd = 主仓根（READ_ONLY 角色物理范围，M8 语义）、
   env = `FLEET_AGENT_ROLE=wisdom` + `FLEET_PERMISSION=READ_ONLY`
   （宪法 II 权限链路——裸请求被适配器拒绝）、timeoutMs 默认
   120_000（可配）。
2. **裁决解析**（宽松两级）：output → JSON
   `{verdict, comments}`（verdict 合法枚举校验）；失败 → 裸行
   `approved` / `changes_requested` 匹配；再失败 → `{ok:false,
   code:'verdict_unparseable'}`。
3. **fail-closed**：适配器失败（timeout / error）或解析失败 →
   ReviewOutcome.ok=false——**不放行、不进修复循环**，直达
   任务失败（review_error 终态）。

## 4. ValidationReviewGate（实现 @fleet/workspace 的 WorkspaceGate）

```ts
interface ValidationGateConfig {
  runner: ValidationRunner;
  reviewer: Reviewer;
  manager: WorkspaceManager;          // diff 与统计
  profile: ValidationProfile;
  repoRoot: string;
  runId?: string;
  emitEvent?: (event: ValidationEvent) => void;
}
class ValidationReviewGate implements WorkspaceGate {
  evaluate(evaluation: GateEvaluation): Promise<GateDecision>;
  readonly packages: ReviewPackage[];
}
```

**合同条款**：

1. **循环不变式**（D2）：rounds ≤ maxReviewLoops；上限检查
   **先于**修复发起（结构性防无限循环）；审阅次数 ≤ 修复
   次数 + 1；maxReviewLoops=0 → 纯验证门（不执行 reviewer）。
2. **修复上下文结构化**：reexecute(feedback) 的 feedback =
   验证失败摘要（fail 检查 + 输出节选）或审阅意见全文——
   不透传自由会话。
3. **终态语义**：approved / review_exceeded / review_error 携带
   `retryable: false`（scheduler 不重试确定性结论，D3）；
   fix_failed（修复执行 runtime 失败）保持可重试（M5 语义）。
4. **事件完备**：每轮 validation.started/completed、每次
   review.started/completed、超限 task.review.exceeded——经
   注入 emitter（缺省丢弃，库层可测）。
5. **报告完备**：每 gated 任务恰好一份 ReviewPackage 进
   packages（含全轮次 artifacts / verdicts / diffStat /
   disposition 填充点）。

## 5. WorkspaceGate 端口（@fleet/workspace 扩展）

```ts
// WorkspaceResolvingExecutor.config 增 gate?: WorkspaceGate
// 执行流：inner 执行后——
//   无 gate：M8 原行为（成功即合 / 失败即弃）
//   有 gate：decision = await gate.evaluate({...execution, reexecute})
//     decision.pass → merge 路径；!pass → destroy 路径（keep-on-finish 仍整体保留）
//     任务结果.ok = decision.pass，detail/outcome 进处置记录
//     executor.reviews 代理 gate.packages（runner duck-typing 合成 RunReport.reviews）
```

**向后兼容**：不传 gate = 逐字节 M8 行为；gate 失败不击穿
调度循环（catch → 任务失败 + 结构化 detail）。

## 6. scheduler 扩展（@fleet/scheduler）

```ts
// TaskExecutor 执行结果增可选字段（缺省 true）
{ ok: boolean; detail?: string; retryable?: boolean }
// settle()：result.retryable === false → 终态 failed（不重入队）
```

既有执行器零改动（缺省可重试）；仅 gate 终态结论使用 false。

## 7. RunReport 扩展（@fleet/runtime）

```ts
// RunReport 增可选字段（duck-typing 合成，同 M8 workspaces 模式）
reviews?: Array<{
  taskId: string;
  terminal: string;
  rounds: number;
  maxReviewLoops: number;
  artifacts: unknown[];      // ValidationArtifact 全轮次
  verdicts: unknown[];       // ReviewVerdict 全轮次
  diffStat: { files: number; insertions: number; deletions: number };
}>;
```

## 8. CLI 行为（fleet run）

- `--no-validation-gate`：关闭验证门 → M8 auto 处置（逃生口）
- 门默认开，**仅 worktree 模式生效**（--no-worktree = M7 直通，
  两开关正交）
- gate 装配：profile = resolveValidationProfile(mission,
  repoRoot)；reviewer = AgentReviewer(registry.resolve('wisdom'))
- 人类报告：每写授权任务追加 `验证 L 轮 · 终态 · 末轮结论` 行
- gate 事件接既有 stderr FleetEvent 通道（serializeEvent）

## 9. mission 文件字段（@fleet/mission 扩展）

```yaml
maxReviewLoops: 2            # 可选；int ≥ 0；缺省 2
validation:                  # 可选
  commands:                  # 显式配置 = 必选（失败即 fail）
    lint: ./checks/lint.sh
    typecheck: tsc --noEmit
    tests: ./checks/tests.sh
  timeoutMs: 300000          # 可选；单命令超时
```

未知字段仍拒绝（strictObject）；既有 mission 兼容。
