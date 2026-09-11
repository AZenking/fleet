import { describe, expect, it } from 'vitest';

import type { AgentRole } from '@fleet/mission';
import { FakeRuntimeAdapter } from '@fleet/runtime';

import { allAgentDefinitions } from './definitions.js';
import { AgentTaskExecutor } from './executor.js';
import {
  assertRequestPermission,
  permissionOf,
  ROLE_PERMISSIONS,
} from './policy.js';
import { RuntimeRegistry, registerRuntimeFactory } from './registry.js';

/**
 * US1/US3 单元（tasks.md T009）：权限矩阵逐项断言（宪法 II）、
 * 注册表行为、执行器请求构造。
 */

function task(input: { id: string; role: AgentRole; constraints?: unknown[] }) {
  return {
    id: input.id,
    goal: `目标-${input.id}`,
    agentRole: input.role,
    dependsOn: [],
    ...(Array.isArray(input.constraints)
      ? { constraints: input.constraints }
      : {}),
  } as Parameters<AgentTaskExecutor['execute']>[0];
}

describe('Tool Policy：权限矩阵（宪法 II / SC-002）', () => {
  it('五角色矩阵逐项断言', () => {
    expect(ROLE_PERMISSIONS).toEqual({
      reflex: 'LIGHT_WRITE',
      focus: 'READ_ONLY',
      reason: 'DEEP_WRITE',
      insight: 'READ_ONLY',
      wisdom: 'READ_ONLY',
    });
  });

  it('角色定义与矩阵一致（定义必经 policy）', () => {
    for (const definition of allAgentDefinitions()) {
      expect(definition.permission).toBe(permissionOf(definition.role));
      expect(definition.systemPromptSegment.length).toBeGreaterThan(0);
    }
    expect(allAgentDefinitions()).toHaveLength(5);
  });

  it('裸请求被拒绝（无权限声明）', () => {
    const outcome = assertRequestPermission({
      runId: 'run_x',
      agentId: 'agent:x',
      cwd: '/repo',
      prompt: 'p',
      timeoutMs: 1000,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain('缺少权限声明');
  });

  it('非法枚举 / 角色不一致被拒绝；合法通过', () => {
    const base = {
      runId: 'run_x',
      agentId: 'agent:x',
      cwd: '/repo',
      prompt: 'p',
      timeoutMs: 1000,
    } as const;
    expect(
      assertRequestPermission({
        ...base,
        env: { FLEET_PERMISSION: 'SUPER_USER' },
      }).ok,
    ).toBe(false);
    expect(
      assertRequestPermission({
        ...base,
        env: { FLEET_AGENT_ROLE: 'focus', FLEET_PERMISSION: 'DEEP_WRITE' },
      }).ok,
    ).toBe(false);
    expect(
      assertRequestPermission({
        ...base,
        env: { FLEET_AGENT_ROLE: 'focus', FLEET_PERMISSION: 'READ_ONLY' },
      }).ok,
    ).toBe(true);
  });
});

describe('RuntimeRegistry', () => {
  it('缺省 fake；单角色覆盖；多对一合法', () => {
    const registry = RuntimeRegistry.fromSpec(['reason=pi']);
    expect(registry.resolve('reason')).toBeInstanceOf(Object);
    expect(registry.nameOf('reason')).toBe('pi');
    expect(registry.nameOf('focus')).toBe('fake'); // 缺省
    const all = RuntimeRegistry.fromSpec(['codex']);
    expect(all.nameOf('reflex')).toBe('codex');
    expect(all.nameOf('wisdom')).toBe('codex'); // 多对一
  });

  it('未知名义 / 未知角色 → 明确报错（不静默回退）', () => {
    expect(() => RuntimeRegistry.fromSpec(['nope'])).toThrow(/未知运行时/);
    expect(() => RuntimeRegistry.fromSpec(['hacker=pi'])).toThrow(/未知角色/);
  });

  it('registerRuntimeFactory：自定义命令名（替身充当真实 CLI）', () => {
    registerRuntimeFactory(
      'stand-in',
      () => new FakeRuntimeAdapter({ zeroDelays: true }),
    );
    const registry = RuntimeRegistry.fromSpec(['reason=stand-in']);
    expect(registry.nameOf('reason')).toBe('stand-in');
  });
});

describe('AgentTaskExecutor（请求构造，SC-005 载体）', () => {
  it('请求含角色片段 + ROLE + PERMISSION + runtime 名义；权限必经矩阵', async () => {
    const registry = RuntimeRegistry.fromSpec([]);
    const fake = registry.resolve('reason') as FakeRuntimeAdapter;
    const executor = new AgentTaskExecutor({ registry, cwd: '/repo' });
    await executor.execute(task({ id: 'build', role: 'reason' }));
    const [request] = fake.requests;
    expect(request.prompt).toContain('[reason · DEEP_WRITE]');
    expect(request.prompt).toContain('[任务 build] 目标-build');
    expect(request.env?.FLEET_AGENT_ROLE).toBe('reason');
    expect(request.env?.FLEET_PERMISSION).toBe('DEEP_WRITE');
    expect(executor.requests[0]).toMatchObject({
      taskId: 'build',
      role: 'reason',
      permission: 'DEEP_WRITE',
      runtime: 'fake',
    });
  });

  it('只读角色请求不含写授权（SC-002 后半）', async () => {
    const registry = RuntimeRegistry.fromSpec([]);
    const fake = registry.resolve('focus') as FakeRuntimeAdapter;
    const executor = new AgentTaskExecutor({ registry, cwd: '/repo' });
    await executor.execute(task({ id: 'scan', role: 'focus' }));
    expect(fake.requests[0]?.env?.FLEET_PERMISSION).toBe('READ_ONLY');
    expect(fake.requests[0]?.prompt).toContain('只读');
  });

  it('timeout 三档推导（task > mission > 默认 5000）', async () => {
    const registry = RuntimeRegistry.fromSpec([]);
    const executor = new AgentTaskExecutor({
      registry,
      cwd: '/repo',
      missionMaxDurationMs: 60000,
    });
    await executor.execute(task({ id: 'a', role: 'reason' }));
    expect(executor.perTaskTimeoutMs.get('a')).toBe(60000);
    await executor.execute(
      task({
        id: 'b',
        role: 'reason',
        constraints: [{ kind: 'maxDurationMs', value: 999 }],
      }),
    );
    expect(executor.perTaskTimeoutMs.get('b')).toBe(999);
    const bare = new AgentTaskExecutor({ registry, cwd: '/repo' });
    await bare.execute(task({ id: 'c', role: 'reason' }));
    expect(bare.perTaskTimeoutMs.get('c')).toBe(5000);
  });

  it('每次执行新 runId（重试）', async () => {
    const registry = RuntimeRegistry.fromSpec([]);
    const executor = new AgentTaskExecutor({ registry, cwd: '/repo' });
    const t = task({ id: 'r', role: 'reason' });
    await executor.execute(t);
    await executor.execute(t);
    expect(executor.requests).toHaveLength(2);
    expect(executor.requests[0]!.runId).not.toBe(executor.requests[1]!.runId);
  });
});
