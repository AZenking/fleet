import { z } from 'zod';

/**
 * 任务域实体（data-model.md §1–§8）。
 *
 * 全树 strictObject——未知字段拒绝（FR-002，拼写错误不静默丢失）；
 * planningMode 大小写敏感（宪法 V 的输入契约：execution 方案已确认、
 * 不可被 Reason 推翻）。跨字段/跨元素规则在 semantic.ts（M5 可复用）。
 */

/** id 命名规则：首字符限数字/小写字母，防 `-x` 怪名 */
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** 宪法 II 认知五级（执行期权限强制是 M7/M8，此处仅枚举） */
export const agentRoleSchema = z.enum([
  'reflex',
  'focus',
  'reason',
  'insight',
  'wisdom',
]);
export type AgentRole = z.infer<typeof agentRoleSchema>;

export const AGENT_ROLES = agentRoleSchema.options;

export const requirementSchema = z.strictObject({
  id: z.string().regex(ID_PATTERN).optional(),
  text: z.string().min(1),
});
export type Requirement = z.infer<typeof requirementSchema>;

/** 内建约束（discriminatedUnion：参数按 kind 类型化，未知 kind 拒绝） */
export const constraintSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('maxDurationMs'),
    value: z.number().int().nonnegative(),
  }),
  z.strictObject({
    kind: z.literal('maxTokens'),
    value: z.number().int().nonnegative(),
  }),
]);
export type Constraint = z.infer<typeof constraintSchema>;

export const CONSTRAINT_KINDS = ['maxDurationMs', 'maxTokens'] as const;

export const acceptanceCriteriaSchema = z.strictObject({
  given: z.string().min(1),
  when: z.string().min(1),
  then: z.string().min(1),
});
export type AcceptanceCriteria = z.infer<typeof acceptanceCriteriaSchema>;

/** 已确认方案的锚点（execution 必填）；任务分解即 mission.tasks */
export const planSchema = z.strictObject({
  summary: z.string().min(1),
  rationale: z.string().optional(),
});
export type Plan = z.infer<typeof planSchema>;

export const taskSchema = z.strictObject({
  id: z.string().regex(ID_PATTERN),
  goal: z.string().min(1),
  agentRole: agentRoleSchema,
  dependsOn: z.array(z.string()).default([]),
  constraints: z.array(constraintSchema).optional(),
  acceptance: z.array(acceptanceCriteriaSchema).optional(),
});
export type Task = z.infer<typeof taskSchema>;

export const planningModeSchema = z.enum(['autonomous', 'execution']);
export type PlanningMode = z.infer<typeof planningModeSchema>;

export const missionSchema = z.strictObject({
  id: z.string().regex(ID_PATTERN),
  goal: z.string().min(1),
  planningMode: planningModeSchema,
  requirements: z.array(requirementSchema).min(1),
  constraints: z.array(constraintSchema).default([]),
  acceptance: z.array(acceptanceCriteriaSchema).min(1),
  plan: planSchema.optional(),
  tasks: z.array(taskSchema).optional(),
});
export type Mission = z.infer<typeof missionSchema>;

/**
 * Artifact / Run：本里程碑仅定义 schema（FR-008），实例由 M5/M6
 * 产生；字段形态对齐 roadmap M11 的 .fleet/runs/ 持久化预告。
 */
export const artifactSchema = z.strictObject({
  id: z.string().regex(/^art_[a-z0-9][a-z0-9-]*$/),
  taskId: z.string().regex(ID_PATTERN),
  kind: z.string().min(1),
  payload: z.unknown(),
  createdAt: z.string().min(1),
});
export type Artifact = z.infer<typeof artifactSchema>;

export const runStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const taskRunStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
  'skipped',
]);
export type TaskRunStatus = z.infer<typeof taskRunStatusSchema>;

export const taskRunSchema = z.strictObject({
  taskId: z.string().regex(ID_PATTERN),
  status: taskRunStatusSchema,
  agentRole: agentRoleSchema,
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
});
export type TaskRun = z.infer<typeof taskRunSchema>;

export const runSchema = z.strictObject({
  id: z.string().regex(/^run_[a-z0-9][a-z0-9-]*$/),
  missionId: z.string().regex(ID_PATTERN),
  status: runStatusSchema,
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  taskRuns: z.array(taskRunSchema).default([]),
});
export type Run = z.infer<typeof runSchema>;
