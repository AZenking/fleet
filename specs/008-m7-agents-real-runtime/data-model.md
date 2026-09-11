# Data Model: M7 五角色 Agent + 真实 Runtime

**Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

结构定义于 `packages/agents/src/*` 与 `packages/runtime/src/*`；
契约细节见 [contracts/agents-policy.md](contracts/agents-policy.md)。
复用：M4 AgentRole、M6 RuntimeRequest/Result/Adapter、M5
TaskExecutor。

## 1. Permission（宪法 II 矩阵的类型化）

| 枚举 | 角色 | 语义 |
|---|---|---|
| `READ_ONLY` | focus / insight / wisdom | 只读（请求不得含写授权） |
| `LIGHT_WRITE` | reflex | 轻量写（仅琐碎任务；范围受限——物理范围 M8） |
| `DEEP_WRITE` | reason | 唯一深度写者 |

```ts
const ROLE_PERMISSIONS: Record<AgentRole, Permission>  // 单一来源（agents/policy）
```

**请求注入**：`env.FLEET_PERMISSION`（executor 构造时必经
policy 取得）；**适配器校验**：`assertRequestPermission(request)`
——env 无合法 permission → 拒绝执行（结构化 error，不启动
子进程）。

## 2. AgentDefinition

| 字段 | 类型 | 规则 |
|---|---|---|
| `role` | AgentRole | 五角色之一 |
| `permission` | Permission | 与矩阵一致（来源 policy） |
| `systemPromptSegment` | string | 职责提示片段（拼进请求 prompt / system prompt） |
| `outputHint` | string | 输出形态提示（结构化产物雏形，M9 消费） |

五角色提示片段语义（内容实现定，语义锚定 roadmap）：reflex
快速分诊 / focus 定位调查 / reason 规划与实现 / insight 验证
取证 / wisdom 审阅裁决。

## 3. RuntimeRegistry

| 成员 | 类型 | 规则 |
|---|---|---|
| `resolve(role)` | → RuntimeAdapter | 未注册（且无缺省）→ 明确错误含角色名；多对一合法 |
| 构造 | `fromSpec(spec, options)` | `--runtime` 解析产物：全局名或 role=name 覆盖；缺省全 Fake 工厂 |

注册的 adapter 名义（名义 = 'fake' | 'codex' | 'gemini' |
'pi' | 自定义命令名——替身测试用）：解析为 adapter 实例的
工厂表；不可用（探测失败）在 CLI 组装期报错（不静默降级）。

## 4. AgentTaskExecutor（TaskExecutor 实现，M6 bridge 进化）

- **构造**：`{ registry, cwd, missionMaxDurationMs?, defaultTimeoutMs? }`
- **execute(task)**：定义查取（提示 + 权限，必经 policy）→
  registry.resolve(task.agentRole) → RuntimeRequest：
  - `prompt` = `[{role} · {permission}] {systemPromptSegment}\n
    [任务 {taskId}] {goal}`
  - `env` = { FLEET_AGENT_ROLE, FLEET_PERMISSION }
  - timeoutMs / runId / agentId 推导同 M6 bridge（三档透传 /
    每执行唯一 / agent:<taskId>）
- **记录**：`requests`（含 runtime 名义与 permission——SC-005
  可追溯载体）/ `taskTimings` / `perTaskTimeoutMs`（runner
  报告合成复用 M6 形态）。

## 5. CliRuntimeAdapter 基座

| 配置项 | 类型 | 说明 |
|---|---|---|
| `command` | string | 命令名（替身可自定义） |
| `buildArgs(request)` | string[] | 参数模板（prompt / 系统提示段 / 权限约束注入） |
| `versionArgs` | string[] | 探测用（默认 ['--version']） |

行为（基座统一，research.md D4）：

```text
execute(request):
  assertRequestPermission（裸请求 → error，不启进程）
  spawn(command, buildArgs(request), { cwd, detached, stdin:ignore })
  竞争（同 M6 单次 settle 守卫）：
    ① 进程退出 → exit 0 ? ok(stdout 截断 64KB) : error(exit+stderr 摘要)
    ② timeoutMs 到 → kill(-pid, SIGKILL) → timeout（迟到输出丢弃）
    ③ cancel(runId) → kill(-pid, SIGKILL) → cancelled
cancel(runId): 在途映射查 runId → kill 组 → settle cancelled
```

## 6. RuntimeAvailability

| 字段 | 类型 | 规则 |
|---|---|---|
| `name` | string | fake / codex / gemini / pi / 自定义 |
| `available` | boolean | 命令存在 + 版本可达 |
| `version` | string? | `--version` 首行 |
| `installHint` | string | 未装时的建议 |

`probeRuntime(name)`：doctor 的 Agent Runtime 检查同源消费。

## 7. 三适配器（薄配置）

| 适配器 | command | 非交互形态 |
|---|---|---|
| PiAdapter | `pi` | `-p --mode text --no-session --append-system-prompt "<角色+权限>" -- <prompt>`（本机 0.85.1 实测） |
| CodexAdapter | `codex` | 非交互 + system prompt 注入（实现期探测校准，D5） |
| GeminiAdapter | `gemini` | 同上 |

权限约束翻译（择最大可执行项）：提示词权限段（全部 CLI 可行）
+ CLI 特定只读/沙箱 flag（有则加，探测期校准）。

## 状态转换

无新增持久状态——执行路径：task → AgentTaskExecutor（角色/
权限/注册解析）→ RuntimeAdapter（Fake 或 CliRuntimeAdapter）→
RuntimeResult；报告与事件沿用 M6 形态（runtime 名义 + permission
进入请求流记录，SC-005）。

## 实体关系总览

```text
Mission.task(agentRole)
  → AgentDefinition（提示/权限 ← policy 单一来源）
  → RuntimeRegistry.resolve(role)（配置行为，可替换）
  → RuntimeRequest（prompt 含角色片段；env 含 ROLE+PERMISSION）
  → CliRuntimeAdapter（裸请求拒绝 → 子进程 → 三路竞争 kill 语义）
     │ 或 FakeRuntimeAdapter（同样校验权限）
  → RuntimeResult → M5 Scheduler → M6 RunReport（可追溯 role→runtime→permission）
```
