/**
 * @fleet/repository — Repository Intelligence（M1：CodeGraph + Fallback；
 * M2：LLM Wiki）。
 *
 * 模块一览（M3 Evidence 从这里直接消费）：
 * - codegraph    CodeGraphAdapter 能力面 + CLI 实现 + 健康判定 + 测试假后端
 * - fallback     原生搜索（rg/内置遍历）、源码锚定校验、git 元信息
 * - investigation  跑 investigate：问题解析 → 策略 → 降级链 → 结果实体
 * - wiki         LLM Wiki：格式层（front matter/围栏）、确定性生成、
 *                index 导航、校验、stale 判定、增量更新、检索
 */

export const REPOSITORY_READY = true;

export * from './codegraph/contract.js';
export * from './codegraph/cli-adapter.js';
export * from './codegraph/health.js';
export * from './codegraph/fake-adapter.js';
export * from './fallback/source.js';
export * from './fallback/search.js';
export * from './fallback/git.js';
export * from './investigation/types.js';
export * from './investigation/planner.js';
export * from './investigation/policy.js';
export * from './investigation/investigate.js';
export * from './wiki/types.js';
export * from './wiki/format.js';
export * from './wiki/git.js';
export * from './wiki/index-writer.js';
export * from './wiki/validator.js';
export * from './wiki/query.js';
export * from './wiki/generator/skeleton.js';
export * from './wiki/generator/build.js';
