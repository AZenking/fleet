import { describe, expect, it } from 'vitest';

import { FakeRuntimeAdapter } from './fake.js';
import type { RuntimeRequest } from './types.js';

/**
 * US2：Fake 行为矩阵（tasks.md T008，roadmap 必测六项主战场）。
 * timeout 诚实 / cancel 即时 / 竞争单次 settle / failure-error /
 * cleanup / 画像与 zeroDelays / 脚本语义。
 */

function request(input: Partial<RuntimeRequest> = {}): RuntimeRequest {
  return {
    runId: `run_test-${Math.random().toString(36).slice(2, 8)}`,
    agentId: 'agent:t1',
    cwd: '/repo',
    prompt: '[任务 t1] 测试',
    timeoutMs: 5000,
    ...input,
  };
}

const ID = 'run_';

describe('timeout 诚实（FR-004 / SC-003）', () => {
  it('hang + timeoutMs=50 → timeout 失败且无迟到成功', async () => {
    const fake = new FakeRuntimeAdapter({
      script: { 'hang-task': [{ outcome: 'hang' }] },
    });
    const started = Date.now();
    const result = await fake.execute(
      request({ timeoutMs: 50, runId: ID + 'to1', agentId: 'agent:hang-task' }),
    );
    const elapsed = Date.now() - started;
    expect(result.ok).toBe(false);
    expect(result.code).toBe('timeout');
    expect(elapsed).toBeGreaterThanOrEqual(45);
    expect(elapsed).toBeLessThan(500);
    expect(fake.inflightSize).toBe(0);
  });

  it('脚本 hang：延迟到点后 settleLog 无第二记录（迟到结果丢弃）', async () => {
    const fake = new FakeRuntimeAdapter({
      script: { 'hang-task': [{ outcome: 'hang' }] },
    });
    const promise = fake.execute(
      request({ timeoutMs: 50, agentId: 'agent:hang-task' }),
    );
    // 等待远超 timeout 与任何脚本延迟——若迟到 settle 会追加记录
    const result = await promise;
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(result.code).toBe('timeout');
    expect(fake.settleLog).toHaveLength(1);
    expect(fake.inflightSize).toBe(0);
  });
});

describe('cancel 即时（FR-005 / SC-004）', () => {
  it('在途执行 cancel → 毫秒级 cancelled，不等延迟走完', async () => {
    const fake = new FakeRuntimeAdapter();
    const runId = ID + 'cx';
    const promise = fake.execute(
      request({ runId, timeoutMs: 5000, agentId: 'agent:hang-task' }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10)); // 确保在途
    const cancelStarted = Date.now();
    await fake.cancel(runId);
    const result = await promise;
    const settleElapsed = Date.now() - cancelStarted;
    expect(result.code).toBe('cancelled');
    expect(settleElapsed).toBeLessThan(50); // 远小于剩余 5000ms
    expect(fake.inflightSize).toBe(0);
  });

  it('并行执行互不影响：cancel 一个，另一个照常完成', async () => {
    const fake = new FakeRuntimeAdapter({
      script: { survivor: [{ outcome: 'success', delayMs: 60 }] },
    });
    const cancelled = fake.execute(
      request({
        runId: ID + 'c1',
        timeoutMs: 5000,
        agentId: 'agent:hang-task',
      }),
    );
    const survivor = fake.execute(
      request({ runId: ID + 'c2', timeoutMs: 5000, agentId: 'agent:survivor' }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    await fake.cancel(ID + 'c1');
    const [firstResult, secondResult] = await Promise.all([
      cancelled,
      survivor,
    ]);
    expect(firstResult.code).toBe('cancelled');
    expect(secondResult.ok).toBe(true);
    expect(fake.inflightSize).toBe(0);
  });

  it('timeout 与 cancel 竞争：先到先得、单次 settle', async () => {
    const fake = new FakeRuntimeAdapter();
    const runId = ID + 'race';
    const promise = fake.execute(
      request({ runId, timeoutMs: 80, agentId: 'agent:hang-task' }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20)); // cancel 先到
    await fake.cancel(runId);
    const result = await promise;
    expect(result.code).toBe('cancelled'); // cancel 先到先得
    await new Promise((resolve) => setTimeout(resolve, 120)); // timeout 到点
    expect(fake.settleLog).toHaveLength(1); // 无第二次 settle
  });

  it('cancel 不存在的 runId：无异常', async () => {
    const fake = new FakeRuntimeAdapter();
    await expect(fake.cancel(ID + 'nope')).resolves.toBeUndefined();
  });
});

describe('failure / error 结构化（必测项）', () => {
  it('failure 脚本 → error 码 + detail', async () => {
    const fake = new FakeRuntimeAdapter({
      script: { t1: [{ outcome: 'failure' }] },
    });
    const result = await fake.execute(request({}));
    expect(result.ok).toBe(false);
    expect(result.code).toBe('error');
    expect(result.detail).toContain('任务失败');
  });

  it('error 脚本 → 内部错误码（异常不逃逸契约）', async () => {
    const fake = new FakeRuntimeAdapter({
      script: { t1: [{ outcome: 'error' }] },
    });
    const result = await fake.execute(request({}));
    expect(result.ok).toBe(false);
    expect(result.code).toBe('error');
  });

  it('success 脚本携带模拟输出', async () => {
    const fake = new FakeRuntimeAdapter({
      script: { t1: [{ outcome: 'success', output: 'fake 分析完成' }] },
    });
    const result = await fake.execute(request({}));
    expect(result.ok).toBe(true);
    expect(result.output).toBe('fake 分析完成');
  });
});

describe('角色画像与 zeroDelays', () => {
  it('画像序：reflex 快于 wisdom（无脚本时）', async () => {
    const fake = new FakeRuntimeAdapter();
    const run = (role: string) =>
      fake.execute(
        request({
          agentId: 'agent:x',
          env: { FLEET_AGENT_ROLE: role },
          timeoutMs: 500,
        }),
      );
    const reflexStart = Date.now();
    await run('reflex');
    const reflexMs = Date.now() - reflexStart;
    const wisdomStart = Date.now();
    await run('wisdom');
    const wisdomMs = Date.now() - wisdomStart;
    expect(reflexMs).toBeLessThan(wisdomMs);
    expect(reflexMs).toBeLessThan(50);
  });

  it('zeroDelays：画像整体置零', async () => {
    const fake = new FakeRuntimeAdapter({ zeroDelays: true });
    const start = Date.now();
    await fake.execute(
      request({
        agentId: 'agent:x',
        env: { FLEET_AGENT_ROLE: 'wisdom' },
        timeoutMs: 500,
      }),
    );
    expect(Date.now() - start).toBeLessThan(30);
  });

  it('脚本耗尽重复末项（重试语义）', async () => {
    const fake = new FakeRuntimeAdapter({
      script: { t1: [{ outcome: 'failure' }, { outcome: 'success' }] },
    });
    const first = await fake.execute(request({ agentId: 'agent:t1' }));
    const second = await fake.execute(request({ agentId: 'agent:t1' }));
    const third = await fake.execute(request({ agentId: 'agent:t1' }));
    expect(first.ok).toBe(false);
    expect(second.ok).toBe(true);
    expect(third.ok).toBe(true); // 末项重复
  });
});

describe('cleanup（FR-006 / SC-005）', () => {
  it('全部结束路径后 inflight 空：成功/失败/timeout/cancel', async () => {
    const adapter = new FakeRuntimeAdapter({
      script: {
        ok: [{ outcome: 'success' }],
        fail: [{ outcome: 'failure' }],
      },
    });
    await adapter.execute(request({ agentId: 'agent:ok' }));
    await adapter.execute(request({ agentId: 'agent:fail' }));
    await adapter.execute(
      request({ timeoutMs: 30, agentId: 'agent:hang-task' }),
    );
    const runId = ID + 'cl';
    const cancelled = adapter.execute(
      request({ runId, timeoutMs: 5000, agentId: 'agent:hang-task' }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    await adapter.cancel(runId);
    await cancelled;
    expect(adapter.inflightSize).toBe(0);
    expect(adapter.settleLog).toHaveLength(4);
  });
});
