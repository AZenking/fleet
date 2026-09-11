# Contract: @fleet/context + @fleet/budget 公共 API

**Spec**: [../spec.md](../spec.md) | **Data Model**: [../data-model.md](../data-model.md)

实现方合同条款（对应 FR-001..011）。

## 1. ContextBuilder（@fleet/context）

```ts
interface BuildInput {
  task: Task;                       // role + dependsOn + goal + constraints
  mission: Mission;                 // 摘要与约束来源
  registry: RunArtifactRegistry;    // 上游产物（D2）
  suppliers?: ContextSuppliers;     // diff / validation / source / config 注入
  feedback?: string;                // 修复轮次上下文（M9 通道）
  budgetOverride?: number;          // 测试/调用方直设（优先于约束）
}
type BuildResult =
  | { ok: true; pkg: ContextPackage }
  | { ok: false; rejection: BudgetRejection };

class ContextBuilder {
  constructor(options?: { charsPerToken?: number; maxCompressionRounds?: number });
  build(input: BuildInput): BuildResult;
}
```

**合同条款**：

1. **构成确定**：sections 完全由 ROLE_CONTEXT_RULES[role] 决定
   （声明式，同输入同输出）；reflex 不含 findings/evidence/diff/
   validation（SC-001 断言面）。
2. **类型闭集**：SECTION_KINDS 之外的 kind 不存在构造路径
   （SC-002 编译期面）；运行时断言 sections 全部 source 非空。
3. **上游解析**：直接 dependsOn 的上游产物按角色映射（focus →
   findings、insight → evidence）；缺失 → unavailable=true（空
   content，不伪造）。
4. **预算阶梯**：budget = task.maxTokens ?? mission.maxTokens ??
   null；超限 → 压缩轮（≤ maxCompressionRounds，缺省 2；priority
   升序、头尾 ~25% + truncation marker）→ 复检；耗尽 → rejection
   （ok=false）。budget=null 零压缩。
5. **优化统计**：optimization.rawTokens = 全部已解析材料（压缩前）
   估算和；packedTokens = totalTokens；savedRatio 派生。

## 2. RunArtifactRegistry（@fleet/context）

```ts
class RunArtifactRegistry {
  record(entry: { taskId; role; ok; output: string }): void;
  outputsOf(taskId): string | undefined;        // 单上游产物
  findings(): Array<{ taskId; role; output }>;  // 全部 focus 产物
  evidences(): Array<{ taskId; role; output }>; // 全部 insight 产物
}
```

run 内内存事实源；record 幂等覆盖（重试/修复轮次取最后一次）。

## 3. render（@fleet/context）

```ts
function render(pkg: ContextPackage): string;
```

确定性文本：`[role · permission]` 首行、`[任务 <id>] <goal>` 次行、
`## <kind>` 分节、feedback 节含 `[修复反馈]` 行。**替身 CLI 的
`[任务 X]` 解析逐字节兼容**（M8/M9 e2e 不动）。unavailable 节渲
染为标注行（不含伪造内容）。

## 4. 估算与记录（@fleet/budget）

```ts
function estimateTokens(text: string, charsPerToken = 4): number;
const DEFAULT_PRICES = { input: 0, output: 0, cached: 0 };
class BudgetLedger {
  record(usage: UsageRecord): void;      // 卫生：负/NaN/非整数丢弃+标注
  snapshot(): BudgetReport;              // mission + tasks 三级视图
}
```

- UsageRecord 由 executor 构造：runtime usage（可缺）+ 实测
  duration + contextSize（口径函数）+ estimatedCost（单价表，
  缺省 0）+ measured 标注。
- 聚合纯加法；修复轮次多次执行同 taskId 累计（executions 明细
  保留）。

## 5. RuntimeResult / FakeStep 扩展（@fleet/runtime）

```ts
interface RuntimeResult { /* 既有 */ usage?: { inputTokens; outputTokens; cachedTokens } }
interface FakeStep { /* 既有 */ usage?: { inputTokens; outputTokens; cachedTokens } }
```

CLI 适配器采纳标记行协议：输出含 `FLEET_USAGE {"inputTokens":..}`
JSON 行才解析（否则 unmeasured）。

## 6. AgentTaskExecutor 接缝（@fleet/agents）

- 构造注入 `{ builder, registry, ledger }`（可选——缺省回退 M7
  手写模板，向后兼容层）。
- execute：builder.build（rejection → `{ok:false, retryable:false,
  detail:超预算明细}`）→ render → RuntimeRequest.prompt → 执行 →
  registry.record + ledger.record。
- 暴露 `budget` getter（runner duck-typing 合成 RunReport.budget）。

## 7. AgentReviewer 迁移（@fleet/validation）

构造注入 builder（缺省内部构造，行为等价 M9）；review 上下文 =
wisdom 规则 + suppliers（validation artifact / diff 摘录）+
priorFeedback；渲染保留 M9 锚（裁决格式说明 / 前轮意见 / 失败
检查摘要）。fail-closed 语义不变。

## 8. RunReport.budget（@fleet/runtime）

duck-typing：executor 暴露 `budget` → `{ mission: {sums,
optimization}, tasks: [...] }`（结构见 data-model §8）。

## 9. CLI（fleet run）

- 装配：builder + registry + ledger 注入 executor 与 reviewer。
- 人类报告追加预算行（每任务 tokens 与节省比；mission 汇总）。
- `--json` 含 report.budget。
