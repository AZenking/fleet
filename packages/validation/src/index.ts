/**
 * @fleet/validation — 独立验收层（宪法 III 核心落点）。
 *
 * - types       实体与事件（ValidationArtifact / ReviewPackage / …）
 * - profile     ValidationProfile 解析（mission 覆盖 → 探测 → skipped）
 * - runner      ValidationRunner（diff + lint/typecheck/tests 受控子进程）
 * - review      AgentReviewer（Wisdom 经 RuntimeAdapter，fail-closed 解析）
 * - gate        ValidationReviewGate（显式循环，上限结构性强制）
 */

export * from './types.js';
export * from './profile.js';
export * from './runner.js';
export * from './review.js';
export * from './gate.js';
