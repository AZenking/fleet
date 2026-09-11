import type { AgentRole } from '@fleet/mission';
import { FakeRuntimeAdapter, type RuntimeAdapter } from '@fleet/runtime';

/**
 * RuntimeRegistry（research.md D7 / data-model.md §3）：
 * role→RuntimeAdapter 的配置行为——替换运行时零改
 * Scheduler/bridge/mission（roadmap M7 验收锚点）。
 * 多对一合法；未知名义在组装期明确报错；自定义命令名可注册
 * （替身测试 / 用户自有 CLI）。
 */

import {
  CodexCliRuntime,
  GeminiCliRuntime,
  PiCliRuntime,
} from '@fleet/runtime';

export type RuntimeName = 'fake' | 'codex' | 'gemini' | 'pi' | (string & {});

const AGENT_ROLES: readonly AgentRole[] = [
  'reflex',
  'focus',
  'reason',
  'insight',
  'wisdom',
];

/** 工厂表：名义 → adapter（延迟实例化；registerFactory 可扩展） */
const FACTORIES: Record<string, () => RuntimeAdapter> = {
  fake: () => new FakeRuntimeAdapter({ zeroDelays: true }),
  pi: () => new PiCliRuntime(),
  codex: () => new CodexCliRuntime(),
  gemini: () => new GeminiCliRuntime(),
};

export function registerRuntimeFactory(
  name: string,
  factory: () => RuntimeAdapter,
): void {
  FACTORIES[name] = factory;
}

export function knownRuntimeNames(): string[] {
  return Object.keys(FACTORIES);
}

function getAdapter(name: string): RuntimeAdapter {
  const factory = FACTORIES[name];
  if (factory === undefined) {
    throw new RangeError(
      `未知运行时：${name}（已知 ${Object.keys(FACTORIES).join(' | ')}；自定义命令名需先 registerRuntimeFactory）`,
    );
  }
  return factory();
}

interface NamedAdapter {
  name: string;
  adapter: RuntimeAdapter;
}

export class RuntimeRegistry {
  private readonly overrides = new Map<AgentRole, NamedAdapter>();
  private fallback: NamedAdapter;

  constructor(
    fallback: RuntimeAdapter = new FakeRuntimeAdapter({ zeroDelays: true }),
  ) {
    this.fallback = { name: 'fake', adapter: fallback };
  }

  resolve(role: AgentRole): RuntimeAdapter {
    return (this.overrides.get(role) ?? this.fallback).adapter;
  }

  /** 名义查询（请求流记录 / 事件 payload：role→runtime 名义） */
  nameOf(role: AgentRole): string {
    return (this.overrides.get(role) ?? this.fallback).name;
  }

  /**
   * 解析 `--runtime` 产物：'name'（全局兜底）或 'role=name'（单角色
   * 覆盖），可重复（后项覆盖前项）。未知名义 / 未知角色 → 抛错
   * （CLI 组装期 = 显式报错，不静默降级）。
   */
  static fromSpec(specs: readonly string[]): RuntimeRegistry {
    let registry = new RuntimeRegistry();
    for (const spec of specs) {
      const match = /^([a-z]+)=(.+)$/.exec(spec);
      if (match === null) {
        registry = new RuntimeRegistry();
        registry.fallback = { name: spec, adapter: getAdapter(spec) };
        continue;
      }
      const role = match[1] as AgentRole;
      if (!AGENT_ROLES.includes(role)) {
        throw new RangeError(
          `--runtime ${spec}：未知角色 ${match[1]}（五角色 = ${AGENT_ROLES.join('/')}）`,
        );
      }
      registry.overrides.set(role, {
        name: match[2]!,
        adapter: getAdapter(match[2]!),
      });
    }
    return registry;
  }
}
