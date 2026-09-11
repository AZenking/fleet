import type { Mission, Task } from '@fleet/mission';
import { estimateTokens } from '@fleet/budget';

import {
  ROLE_CONTEXT_RULES,
  type ArtifactEntry,
  type BuildInput,
  type BuildResult,
  type BudgetRejection,
  type ContextPackage,
  type ContextSection,
  type SectionKind,
  type SectionSpec,
} from './types.js';
import { compressSections } from './compress.js';

/**
 * ContextBuilder（research.md D3/D7）：按 ROLE_CONTEXT_RULES 声明式
 * 装配（同输入同输出）；上游产物按 DAG 直接依赖解析（无依赖时取
 * 全量同角色产物——wisdom 对 findings 的兜底）；缺失标注
 * unavailable 不伪造。预算阶梯：超限 → 规则压缩（≤2 轮）→ 复检
 * → 仍超 → BudgetRejection（零 LLM，宪法 V）。
 */

export interface ContextBuilderOptions {
  charsPerToken?: number;
  maxCompressionRounds?: number;
}

const DEFAULTS = { charsPerToken: 4, maxCompressionRounds: 2 };

export class ContextBuilder {
  private readonly charsPerToken: number;
  private readonly maxCompressionRounds: number;

  constructor(options: ContextBuilderOptions = {}) {
    this.charsPerToken = options.charsPerToken ?? DEFAULTS.charsPerToken;
    this.maxCompressionRounds =
      options.maxCompressionRounds ?? DEFAULTS.maxCompressionRounds;
  }

  build(input: BuildInput): BuildResult {
    const sections = ROLE_CONTEXT_RULES[input.task.agentRole].map((spec) =>
      this.resolve(spec, input),
    );
    const rawTokens = sumTokens(sections);
    const budget = resolveBudget(input);

    if (budget.limit !== null && rawTokens > budget.limit) {
      const limit = budget.limit;
      const level: 'task' | 'mission' =
        budget.level === 'mission' ? 'mission' : 'task';
      const compressed = compressSections(
        sections,
        limit,
        this.maxCompressionRounds,
        this.charsPerToken,
      );
      if (!compressed.fits) {
        return {
          ok: false,
          rejection: rejectionOf(input.task.id, { limit, level }, compressed),
        };
      }
      return {
        ok: true,
        pkg: this.package(
          input,
          compressed.sections,
          budget,
          compressed.rounds,
          rawTokens,
        ),
      };
    }

    return {
      ok: true,
      pkg: this.package(input, sections, budget, 0, rawTokens),
    };
  }

  private package(
    input: BuildInput,
    sections: ContextSection[],
    budget: { limit: number | null; level: 'task' | 'mission' | null },
    compressions: number,
    rawTokens: number,
  ): ContextPackage {
    const packed = sumTokens(sections);
    return {
      taskId: input.task.id,
      role: input.task.agentRole,
      sections,
      totalTokens: packed,
      budget,
      compressions,
      optimization: {
        rawTokens,
        packedTokens: packed,
        savedRatio:
          rawTokens > 0
            ? Math.round((1 - packed / rawTokens) * 1000) / 1000
            : 0,
      },
    };
  }

  private resolve(spec: SectionSpec, input: BuildInput): ContextSection {
    const resolved = contentOf(spec.kind, input);
    return {
      kind: spec.kind,
      source: resolved.source,
      content: resolved.content,
      sizeTokens: estimateTokens(resolved.content, this.charsPerToken),
      priority: spec.priority,
      truncated: false,
      unavailable: resolved.unavailable,
    };
  }
}

type Resolved = { source: string; content: string; unavailable: boolean };

function contentOf(kind: SectionKind, input: BuildInput): Resolved {
  const { task, mission, registry, suppliers, feedback } = input;
  switch (kind) {
    case 'mission':
      return {
        source: 'mission',
        content: missionSummary(mission),
        unavailable: false,
      };
    case 'taskGoal':
      return {
        source: `task:${task.id}`,
        content: task.goal,
        unavailable: false,
      };
    case 'constraints':
      return {
        source: 'mission',
        content: constraintsOf(task, mission),
        unavailable: false,
      };
    case 'feedback':
      return feedback !== undefined
        ? { source: 'feedback', content: feedback, unavailable: false }
        : { source: 'feedback', content: '', unavailable: true };
    case 'findings':
      return upstreamOf(task, registry, 'focus', 'findings');
    case 'evidence':
      return upstreamOf(task, registry, 'insight', 'evidence');
    case 'source':
      return supplied(suppliers?.source, 'source');
    case 'diff':
      return supplied(suppliers?.diff, 'diff');
    case 'validation':
      return supplied(suppliers?.validation, 'validation');
    case 'config':
      return supplied(suppliers?.config, 'config');
  }
}

function supplied(content: string | undefined, source: string): Resolved {
  return content !== undefined
    ? { source, content, unavailable: false }
    : { source, content: '', unavailable: true };
}

/** 直接上游优先；无依赖时兜底全量同角色产物（顺序 = record 序） */
function upstreamOf(
  task: Task,
  registry: BuildInput['registry'],
  role: 'focus' | 'insight',
  source: string,
): Resolved {
  const ofRole = (entry: ArtifactEntry | undefined): entry is ArtifactEntry =>
    entry !== undefined && entry.role === role && entry.ok;
  let entries: ArtifactEntry[];
  if (task.dependsOn.length > 0) {
    entries = task.dependsOn
      .map((dep) => registry.outputsOf(dep))
      .filter(ofRole);
  } else {
    entries = role === 'focus' ? registry.findings() : registry.evidences();
  }
  if (entries.length === 0) {
    return { source, content: '', unavailable: true };
  }
  return {
    source,
    content: entries
      .map((entry) => `[上游 ${entry.taskId}]\n${entry.output}`)
      .join('\n\n'),
    unavailable: false,
  };
}

function missionSummary(mission: Mission): string {
  const requirements = mission.requirements
    .map((req, index) => `${index + 1}. ${req.text}`)
    .join('\n');
  return `目标：${mission.goal}\n需求：\n${requirements}`;
}

function constraintsOf(task: Task, mission: Mission): string {
  const lines = [
    ...(task.constraints ?? []).map((c) => `task.${c.kind} = ${c.value}`),
    ...mission.constraints.map((c) => `mission.${c.kind} = ${c.value}`),
  ];
  return lines.length > 0 ? lines.join('\n') : '';
}

function resolveBudget(input: BuildInput): {
  limit: number | null;
  level: 'task' | 'mission' | null;
} {
  if (input.budgetOverride !== undefined) {
    return { limit: input.budgetOverride, level: 'task' };
  }
  const taskLevel = (input.task.constraints ?? []).find(
    (constraint) => constraint.kind === 'maxTokens',
  );
  if (taskLevel !== undefined) {
    return { limit: taskLevel.value, level: 'task' };
  }
  const missionLevel = input.mission.constraints.find(
    (constraint) => constraint.kind === 'maxTokens',
  );
  if (missionLevel !== undefined) {
    return { limit: missionLevel.value, level: 'mission' };
  }
  return { limit: null, level: null };
}

function sumTokens(sections: ContextSection[]): number {
  return sections.reduce((sum, section) => sum + section.sizeTokens, 0);
}

function rejectionOf(
  taskId: string,
  budget: { limit: number; level: 'task' | 'mission' },
  compressed: { sections: ContextSection[]; rounds: number },
): BudgetRejection {
  return {
    taskId,
    limit: budget.limit,
    level: budget.level,
    rounds: compressed.rounds,
    sections: compressed.sections.map((section) => ({
      kind: section.kind,
      sizeTokens: section.sizeTokens,
      truncated: section.truncated,
    })),
  };
}
