# Contract: 角色定义 / 权限矩阵 / 注册表（M7）

**Date**: 2026-09-11 | **Spec**: [spec.md](../spec.md)

## 权限矩阵（宪法 II，单一来源 agents/policy.ts）

| 角色 | permission | 语义 |
|---|---|---|
| reflex | `LIGHT_WRITE` | 轻量写——仅琐碎任务 |
| focus | `READ_ONLY` | 定位调查，不修改代码 |
| reason | `DEEP_WRITE` | 唯一深度写者 |
| insight | `READ_ONLY` | 验证取证 |
| wisdom | `READ_ONLY` | 审阅裁决 |

- **请求必达**：所有发往 RuntimeAdapter 的请求 `env` 必含
  `FLEET_PERMISSION`（构造必经 Tool Policy）。
- **裸请求拒绝**：适配器入口 `assertRequestPermission`——缺失
  或非法 → `{ok:false, code:'error', detail:'请求缺少权限声明…'}`
  且**不启动子进程**。Fake 同样校验。
- **只读翻译**：READ_ONLY 请求的运行时约束不含写授权路径
  （提示词权限段 + CLI 特定 flag 择最大可执行项）。
- **物理隔离**：Worktree 物理隔离属 M8（本里程碑不宣称）。

## RuntimeRequest 扩展（env 通道）

```json
{
  "runId": "run_…", "agentId": "agent:build-core", "cwd": "/repo",
  "prompt": "[reason · DEEP_WRITE] 规划与实现…\n[任务 build-core] 目标…",
  "env": { "FLEET_AGENT_ROLE": "reason", "FLEET_PERMISSION": "DEEP_WRITE" },
  "timeoutMs": 60000
}
```

## RuntimeRegistry

```ts
// CLI 解析：--runtime fake（全局）| --runtime reason=pi（单角色覆盖），可重复
const registry = RuntimeRegistry.fromSpec(['reason=pi']);   // 其余缺省 fake
registry.resolve('reason'); // PiAdapter 实例；未注册（无缺省时）→ 明确错误
```

- 多对一合法（全接 codex）；显式指定的运行时不可用 → 组装期
  报错（探测结果 + 安装建议），**不静默降级 Fake**。

## CliRuntimeAdapter 行为保证（M6 四条款的进程版）

1. 异常不逃逸：spawn/kill 异常 → error 码
2. timeout 诚实：超预算 → `kill(-pid, SIGKILL)` 进程组 →
   timeout；迟到输出丢弃（单次 settle）
3. cancel 即时：在途 cancel → 进程组 SIGKILL → cancelled
   （毫秒级）；孙进程同灭（detached + 负 PID）
4. 清理完备：任意路径无孤儿进程（pid 存在性断言）；无 stdin
   （交互即超时路径）；stdout 截断 64KB + 标注

## 适配器参数

| name | command | 非交互形态 |
|---|---|---|
| fake | — | M6 FakeRuntimeAdapter（零延迟可配） |
| pi | `pi` | `-p --mode text --no-session --append-system-prompt "<角色+权限>" -- <prompt>`（实测 0.85.1） |
| codex / gemini | 同名 CLI | 非交互 + system prompt 注入（实现期探测校准） |
