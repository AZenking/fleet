/**
 * @fleet/agents — Fleet 认知角色层（M7）。
 *
 * 模块一览（M8 Workspace / M9 验证层从这里消费）：
 * - policy       权限矩阵单一来源（宪法 II）+ 请求权限断言
 * - definitions  五角色定义（职责提示片段 / 权限 / 输出形态提示）
 * - registry     RuntimeRegistry（role→runtime 配置行为，可替换）
 * - executor     AgentTaskExecutor（角色解析 + 权限注入 + 请求记录）
 */

export const AGENTS_READY = true;

export * from './policy.js';
export * from './definitions.js';
export * from './registry.js';
export * from './executor.js';
