import type { AgentRole } from '@fleet/mission';

import {
  ROLE_DELAY_PROFILE_MS,
  type FakeStep,
  type RuntimeAdapter,
  type RuntimeRequest,
  type RuntimeResult,
} from './types.js';

/**
 * FakeRuntimeAdapter（research.md D2/D3）：契约参考实现与测试底座。
 *
 * 单次执行 = 三路竞争（脚本延迟 / timeout / cancel）汇入唯一
 * finish()——settled 守卫保证单次 settle，进入即 clearTimeout 全量
 * 并出 inflight 表：迟到结果丢弃、无悬挂计时器（契约条款 2/3/4）。
 */

interface InflightRun {
  settled: boolean;
  timers: Array<ReturnType<typeof setTimeout>>;
  cancelFn: () => void;
}

export interface FakeRuntimeOptions {
  /** 按 taskId 脚本化（按调用序出队，耗尽重复末项） */
  script?: Record<string, FakeStep[]>;
  /** 角色画像整体置零（CI 快跑） */
  zeroDelays?: boolean;
}

export class FakeRuntimeAdapter implements RuntimeAdapter {
  private readonly script: Record<string, FakeStep[]>;
  private readonly zeroDelays: boolean;
  private readonly inflight = new Map<string, InflightRun>();
  readonly requests: RuntimeRequest[] = [];
  readonly settleLog: Array<{ runId: string; result: RuntimeResult }> = [];

  constructor(options: FakeRuntimeOptions = {}) {
    this.script = Object.fromEntries(
      Object.entries(options.script ?? {}).map(([key, steps]) => [
        key,
        [...steps],
      ]),
    );
    this.zeroDelays = options.zeroDelays === true;
  }

  /** 在途执行数（cleanup 断言：结束后 === 0） */
  get inflightSize(): number {
    return this.inflight.size;
  }

  /** 每任务收到的请求次数（桥接/重试断言） */
  requestsFor(agentId: string): RuntimeRequest[] {
    return this.requests.filter((request) => request.agentId === agentId);
  }

  async execute(request: RuntimeRequest): Promise<RuntimeResult> {
    this.requests.push(request);
    const taskId = request.agentId.replace(/^agent:/, '');
    const role = roleOf(request);
    const step = this.dequeue(taskId);

    return new Promise<RuntimeResult>((resolve) => {
      const run: InflightRun = {
        settled: false,
        timers: [],
        cancelFn: () => {},
      };
      this.inflight.set(request.runId, run);

      const finish = (result: RuntimeResult): void => {
        if (run.settled) {
          return; // 单次 settle 守卫：迟到结果（含成功）丢弃
        }
        run.settled = true;
        for (const timer of run.timers) {
          clearTimeout(timer); // 清理完备：全部路径无悬挂计时器
        }
        this.inflight.delete(request.runId);
        this.settleLog.push({ runId: request.runId, result });
        resolve(result);
      };

      run.cancelFn = () =>
        finish({
          ok: false,
          code: 'cancelled',
          detail: `run ${request.runId} 已取消`,
        });

      // ① 脚本延迟（hang 不设——永不自行完成）
      if (step.outcome !== 'hang') {
        const delay = this.zeroDelays
          ? 0
          : (step.delayMs ?? ROLE_DELAY_PROFILE_MS[role]);
        run.timers.push(
          setTimeout(() => {
            if (step.outcome === 'success') {
              finish({
                ok: true,
                ...(step.output !== undefined ? { output: step.output } : {}),
              });
            } else if (step.outcome === 'failure') {
              finish({ ok: false, code: 'error', detail: '模拟任务失败' });
            } else {
              finish({
                ok: false,
                code: 'error',
                detail: '模拟运行时内部错误',
              });
            }
          }, delay),
        );
      }

      // ② timeout 诚实：到点 settle timeout，此后迟到结果被守卫吞掉
      run.timers.push(
        setTimeout(
          () =>
            finish({
              ok: false,
              code: 'timeout',
              detail: `执行超过预算 ${request.timeoutMs}ms`,
            }),
          request.timeoutMs,
        ),
      );
    });
  }

  async cancel(runId: string): Promise<void> {
    this.inflight.get(runId)?.cancelFn();
  }

  private dequeue(taskId: string): FakeStep {
    const steps = this.script[taskId];
    if (steps === undefined || steps.length === 0) {
      return { outcome: 'success' };
    }
    if (steps.length === 1) {
      return steps[0]!;
    }
    return steps.shift()!;
  }
}

function roleOf(request: RuntimeRequest): AgentRole {
  // prompt 模板携带角色？不——桥接未传角色。画像按 agentId 无从
  // 推导时退 reason；真实角色经 bridge 的 execute 上下文传入（见
  // MissionRuntimeBridge：它构造的 prompt 前缀含 taskId，画像键以
  // taskId 查脚本；无脚本时按默认画像的 reason 档）。
  const fromEnv = request.env?.FLEET_AGENT_ROLE;
  if (isRole(fromEnv)) {
    return fromEnv;
  }
  return 'reason';
}

function isRole(value: unknown): value is AgentRole {
  return (
    typeof value === 'string' &&
    ['reflex', 'focus', 'reason', 'insight', 'wisdom'].includes(value)
  );
}
