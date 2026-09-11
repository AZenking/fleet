import { z } from 'zod';

import type { Task } from '@fleet/mission';

/**
 * 调度域实体（data-model.md §1–§6）。状态枚举沿用 M4
 * TaskRunStatus（cancelled 存在于枚举但 M5 不触发——主动取消属
 * M6+）。执行器端口是 M6 RuntimeAdapter 的适配目标（宪法 IV）。
 */

export const nodeStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
  'cancelled',
]);
export type NodeStatus = z.infer<typeof nodeStatusSchema>;

export interface DagNode {
  taskId: string;
  task: Task;
  status: NodeStatus;
  /** 执行次数（含进行中）；终态时 = 实际执行数 */
  attempts: number;
  /** 最后一次失败摘要（执行器 detail 或异常 message） */
  failureReason?: string;
  /** skipped 时指向首个 failed 祖先（传播链） */
  skippedBy?: string;
}

export interface SnapshotNode {
  taskId: string;
  status: NodeStatus;
  attempts: number;
  failureReason?: string;
  skippedBy?: string;
}

export interface StatusCounts {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  skipped: number;
}

/** TaskDag 接口面（实现于 dag.ts，research.md D1） */
export interface TaskDag {
  /** 声明序节点视图 */
  snapshot(): SnapshotNode[];
  node(taskId: string): DagNode | undefined;
  /** 就绪任务（声明序过滤：pending ∧ 依赖全 completed） */
  readyTasks(): DagNode[];
  counts(): StatusCounts;
  /** 失败传播用正向边（dependents） */
  dependentsOf(taskId: string): readonly string[];
}

export interface DispatchRecord {
  taskId: string;
  /** 派发序号（含重试的每次派发） */
  seq: number;
  /** 该任务第几次执行 */
  attempt: number;
}

export interface PropagationChain {
  failedTaskId: string;
  /** 该 failed 的传递 skipped（声明序） */
  skipped: string[];
}

export const runOutcomeStatusSchema = z.enum(['completed', 'failed']);
export type RunOutcomeStatus = z.infer<typeof runOutcomeStatusSchema>;

export interface RunOutcome {
  status: RunOutcomeStatus;
  nodes: SnapshotNode[];
  /** 全部派发（含重试）——SC-006 确定性断言载体 */
  dispatchOrder: string[];
  propagation: PropagationChain[];
  durationMs: number;
}

export interface TaskExecutionResult {
  ok: boolean;
  detail?: string;
}

/**
 * 执行器端口（M6 RuntimeAdapter 的适配目标）：
 * 抛异常 ≡ 失败（调度器 settle 包装捕获，FR-008 不击穿循环）；
 * 无 timeout / cancel——属 M6 RuntimeAdapter 契约。
 */
export interface TaskExecutor {
  execute(task: Task): Promise<TaskExecutionResult>;
}
