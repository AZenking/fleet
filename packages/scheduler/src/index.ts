/**
 * @fleet/scheduler — Fleet Kernel 调度层（M5）。
 *
 * 模块一览（M6 RuntimeAdapter / M7+ Agent 层从这里消费）：
 * - types      DagNode / TaskDag / RunOutcome / TaskExecutor 端口
 * - dag        buildDag（环检测报链）+ readyTasks + snapshot
 * - config     SchedulerConfig（maxConcurrency=3 / retry=1，域校验）
 * - scheduler  确定性 Rule-based 调度循环（批次屏障 + 失败传播）
 * - test-kit   ScriptedExecutor（脚本化假执行器，测试与 M6 e2e 复用）
 */

export const SCHEDULER_READY = true;

export * from './types.js';
export * from './dag.js';
export * from './config.js';
export * from './scheduler.js';
export * from './test-kit.js';
