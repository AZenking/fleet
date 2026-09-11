/**
 * @fleet/runtime — Fleet 运行时层（M6）。
 *
 * 模块一览（M7 真实 Adapter / M11 可观测层从这里消费）：
 * - types    RuntimeRequest / RuntimeResult / RuntimeAdapter 契约 + FakeStep + 角色画像
 * - fake     FakeRuntimeAdapter（契约参考实现：单次 settle / timeout 诚实 / cleanup）
 * - bridge   MissionRuntimeBridge（TaskExecutor 适配——runId/agentId/prompt/timeout 规则）
 * - runner   runMissionFile 编排（校验前置 → DAG/调度 → RunReport + 事件）
 */

export const RUNTIME_READY = true;

export * from './types.js';
export * from './fake.js';
export * from './bridge.js';
export * from './runner.js';
export * from './cli-adapter.js';
export * from './cli-runtimes.js';
export * from './availability.js';
