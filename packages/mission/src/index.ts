/**
 * @fleet/mission — Fleet Kernel 任务域（M4）。
 *
 * 模块一览（M5 Scheduler / M6 Runtime 从这里消费）：
 * - types      Mission / Plan / Task / Requirement / Constraint /
 *              Acceptance / Artifact / Run 的 Zod schema
 * - loader     raw YAML → Mission（FleetError + ConfigIssue 逐字段）
 * - semantic   跨元素语义规则（重复 id / 悬空依赖 / 自环 / 模式完备）
 * - validate   文件校验编排（两层 issues 一次报全）
 */

export const MISSION_READY = true;

export * from './types.js';
export * from './loader.js';
export * from './semantic.js';
export * from './validate.js';
