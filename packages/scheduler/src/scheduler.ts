import { performance } from 'node:perf_hooks';

import { TaskDagImpl } from './dag.js';
import {
  DEFAULT_SCHEDULER_CONFIG,
  resolveSchedulerConfig,
  type SchedulerConfig,
} from './config.js';
import type {
  DagNode,
  PropagationChain,
  RunOutcome,
  TaskExecutor,
} from './types.js';

/**
 * 确定性 Rule-based 调度循环（research.md D4，宪法 V）：
 * 决策串行、执行并发（批次屏障——每批 Promise.all 收齐再决策，
 * 派发序列与状态转换完全确定，SC-006 结构性成立）。
 * 无 LLM、无动态重排；固定 retry；失败传播到不动点。
 */
export class Scheduler {
  private readonly config: SchedulerConfig;

  constructor(config?: Partial<SchedulerConfig>) {
    this.config =
      config === undefined
        ? DEFAULT_SCHEDULER_CONFIG
        : resolveSchedulerConfig(config);
  }

  async run(dag: TaskDagImpl, executor: TaskExecutor): Promise<RunOutcome> {
    const start = performance.now();
    const dispatchOrder: string[] = [];
    let cancelled = false;

    for (;;) {
      // 1. 失败传播（failed → 传递依赖 pending → skipped，不动点）
      this.propagateFailures(dag);
      // 2. M11 cancel 检查点（批次屏障间——此时零在行任务）：
      //    未开始任务不开始，pending → skipped，cancelled 收束
      if (this.config.shouldStop?.() === true) {
        for (const node of dag.allNodes()) {
          if (node.status === 'pending') {
            node.status = 'skipped';
            node.skippedBy = 'cancelled';
          }
        }
        cancelled = true;
        break;
      }
      // 3. 就绪选择（声明序，截断到并发额度）
      const ready = dag.readyTasks().slice(0, this.config.maxConcurrency);
      if (ready.length === 0) {
        break;
      }
      // 4. 派发（并行执行）+ 批次屏障收结果
      for (const node of ready) {
        node.status = 'running';
        node.attempts += 1;
        dispatchOrder.push(node.taskId);
      }
      await this.awaitBatch(ready, executor);
    }

    const counts = dag.counts();
    return {
      status: cancelled
        ? 'cancelled'
        : counts.failed > 0
          ? 'failed'
          : 'completed',
      nodes: dag.snapshot(),
      dispatchOrder,
      propagation: computePropagation(dag),
      durationMs: Math.round(performance.now() - start),
    };
  }

  /**
   * 批次屏障：无 shouldStop = 直接屏障；有则 100ms 轮询——stop
   * 触发 executor.cancelAll?()（runtime cancel 通道），在行任务
   * settle 后返回（宪 V：检查点在屏障间，调度决策仍确定）。
   */
  private async awaitBatch(
    ready: DagNode[],
    executor: TaskExecutor,
  ): Promise<void> {
    const batch = Promise.all(ready.map((node) => this.settle(node, executor)));
    if (this.config.shouldStop === undefined) {
      await batch;
      return;
    }
    for (;;) {
      const winner = await Promise.race([
        batch.then(() => 'done' as const),
        sleep(100).then(() => 'tick' as const),
      ]);
      if (winner === 'done') {
        return;
      }
      if (this.config.shouldStop?.() === true) {
        await executor.cancelAll?.();
        await batch; // cancel 使在行任务 settle（迟到结果被丢弃）
        return;
      }
    }
  }

  /** settle：成功 → completed；失败且可重试 → pending（下批重试）；否则 failed。异常 ≡ 失败（不击穿）。 */
  private async settle(node: DagNode, executor: TaskExecutor): Promise<void> {
    try {
      const result = await executor.execute(node.task);
      if (result.ok) {
        node.status = 'completed';
        return;
      }
      // M9 终态信号：确定性结论不重试（重试不改判，防轮次预算翻倍）
      if (result.retryable === false) {
        node.status = 'failed';
        node.failureReason = result.detail ?? '执行失败（终态，不可重试）';
        return;
      }
      this.recordFailure(node, result.detail ?? '执行失败');
    } catch (error) {
      this.recordFailure(
        node,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private recordFailure(node: DagNode, detail: string): void {
    if (node.attempts <= this.config.retry) {
      node.status = 'pending'; // 重新入队，下一批重试
    } else {
      node.status = 'failed';
      node.failureReason = detail;
    }
  }

  /** failed → 沿 dependents BFS：pending → skipped（skippedBy = 首个 failed 祖先） */
  private propagateFailures(dag: TaskDagImpl): void {
    for (const failed of dag.allNodes()) {
      if (failed.status !== 'failed') {
        continue;
      }
      const queue = [...dag.dependentsOf(failed.taskId)];
      while (queue.length > 0) {
        const current = queue.shift()!;
        const node = dag.node(current);
        if (node === undefined) {
          continue;
        }
        if (node.status === 'pending') {
          node.status = 'skipped';
          node.skippedBy = failed.taskId;
        }
        // completed/running 不改写（FR-007）；skipped/failed 不重复处理
        if (node.status !== 'completed' && node.status !== 'running') {
          queue.push(...dag.dependentsOf(current));
        }
      }
    }
  }
}

/** 传播链汇总：failed（声明序）→ 其传递 skipped（声明序） */
function computePropagation(dag: TaskDagImpl): PropagationChain[] {
  const order = new Map(
    dag.allNodes().map((node, index) => [node.taskId, index]),
  );
  const chains: PropagationChain[] = [];
  for (const failed of dag.allNodes()) {
    if (failed.status !== 'failed') {
      continue;
    }
    const skipped = dag
      .allNodes()
      .filter(
        (node) => node.status === 'skipped' && node.skippedBy === failed.taskId,
      )
      .map((node) => node.taskId);
    if (skipped.length > 0) {
      chains.push({
        failedTaskId: failed.taskId,
        skipped: skipped.sort(
          (a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0),
        ),
      });
    }
  }
  return chains;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
