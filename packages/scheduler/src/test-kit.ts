import type { Task } from '@fleet/mission';

import type { TaskExecutionResult, TaskExecutor } from './types.js';

/**
 * ScriptedExecutor（research.md D6）：脚本化假执行器——按调用序
 * 出队脚本项（'boom' = 抛异常；耗尽重复末项），记录调用序与
 * 并发峰值。M5 测试的执行器，M6 e2e 可复用。
 */

export type ScriptStep = 'success' | 'failure' | 'boom';

export interface ScriptedExecutorOptions {
  /** 每任务按调用序的脚本（耗尽重复末项） */
  script: Record<string, ScriptStep[]>;
  /** 每次执行延迟（真实并发时序验收用） */
  delayMs?: number;
}

export class ScriptedExecutor implements TaskExecutor {
  private readonly queue = new Map<string, ScriptStep[]>();
  private active = 0;
  peak = 0;
  readonly callLog: string[] = [];

  constructor(private readonly options: ScriptedExecutorOptions) {
    for (const [taskId, steps] of Object.entries(options.script)) {
      this.queue.set(taskId, [...steps]);
    }
  }

  /** 每任务实际执行次数 */
  callsOf(taskId: string): number {
    return this.callLog.filter((entry) => entry === taskId).length;
  }

  async execute(task: Task): Promise<TaskExecutionResult> {
    this.callLog.push(task.id);
    this.active += 1;
    this.peak = Math.max(this.peak, this.active);
    try {
      if ((this.options.delayMs ?? 0) > 0) {
        await sleep(this.options.delayMs!);
      }
      const step = this.dequeue(task.id);
      if (step === 'boom') {
        // 真抛异常：验证调度器 settle 包装的"异常 ≡ 失败不击穿"
        throw new Error(`执行器异常（模拟）：${task.id}`);
      }
      if (step === 'failure') {
        return { ok: false, detail: '模拟失败' };
      }
      return { ok: true };
    } finally {
      this.active -= 1;
    }
  }

  private dequeue(taskId: string): ScriptStep {
    const steps = this.queue.get(taskId) ?? ['success'];
    const step = steps.length > 1 ? steps.shift()! : (steps[0] ?? 'success');
    return step;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
