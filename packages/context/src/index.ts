/**
 * @fleet/context — 上下文装配层（M10）。
 *
 * - types       Section/Package/规则表（SECTION_KINDS 闭集）
 * - registry    RunArtifactRegistry（run 内上游产物事实源）
 * - builder     ContextBuilder（角色规则装配 + 预算阶梯）
 * - compress    规则压缩（零 LLM，确定性）
 * - render      确定性渲染（[任务 <id>] 兼容标记）
 */

export * from './types.js';
export * from './registry.js';
export * from './builder.js';
export * from './compress.js';
export * from './render.js';
