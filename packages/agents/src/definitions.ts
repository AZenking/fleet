import type { AgentRole } from '@fleet/mission';

import { permissionOf, type Permission } from './policy.js';

/**
 * 五角色定义（data-model.md §2，roadmap 职责语义锚定）：
 * 提示片段拼进请求 prompt；outputHint 是结构化产物雏形（M9 消费）。
 */

export interface AgentDefinition {
  role: AgentRole;
  permission: Permission;
  /** 职责提示片段（拼进 prompt / system prompt） */
  systemPromptSegment: string;
  /** 输出形态提示（Artifact 管道雏形，完整属后续里程碑） */
  outputHint: string;
}

const DEFINITIONS: Record<
  AgentRole,
  Omit<AgentDefinition, 'role' | 'permission'>
> = {
  reflex: {
    systemPromptSegment:
      '你是 Reflex——快速分诊者：判断任务是否琐碎、可即刻处理；只做轻量修改，遇到复杂实现立即声明需要 Reason。',
    outputHint: '一句话结论 + 是否需要升级（trivial | escalate）',
  },
  focus: {
    systemPromptSegment:
      '你是 Focus——定位调查者：在仓库中定位相关代码与证据，只读不写；输出带文件位置的调查发现。',
    outputHint: '调查发现列表（文件:行 + 陈述）',
  },
  reason: {
    systemPromptSegment:
      '你是 Reason——规划与实现者：制定执行计划并深度实现；你是唯一被授权深度修改代码的角色。',
    outputHint: '实现说明 + 变更文件清单',
  },
  insight: {
    systemPromptSegment:
      '你是 Insight——验证取证者：核对实现与证据（源码/配置/测试），只读不写；指出不一致与风险。',
    outputHint: '验证结论 + 证据引用 + 风险清单',
  },
  wisdom: {
    systemPromptSegment:
      '你是 Wisdom——审阅裁决者：以整体质量与验收标准审阅产出，只读不写；给出裁决（通过 / 需修改）与理由。',
    outputHint: '裁决（approve | changes_requested）+ 理由',
  },
};

const REGISTRY = new Map<AgentRole, AgentDefinition>(
  (Object.keys(DEFINITIONS) as AgentRole[]).map((role) => [
    role,
    { role, permission: permissionOf(role), ...DEFINITIONS[role] },
  ]),
);

export function getAgentDefinition(role: AgentRole): AgentDefinition {
  const definition = REGISTRY.get(role);
  if (definition === undefined) {
    throw new RangeError(
      `未知角色：${role}（五角色 = reflex/focus/reason/insight/wisdom）`,
    );
  }
  return definition;
}

export function allAgentDefinitions(): AgentDefinition[] {
  return [...REGISTRY.values()];
}
