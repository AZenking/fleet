import { describe, expect, it } from 'vitest';
import { loadMission } from '@fleet/mission';

import { ContextBuilder } from './builder.js';
import { render } from './render.js';
import { RunArtifactRegistry } from './registry.js';
import { compressSections, TRUNCATION_MARKER } from './compress.js';
import {
  ROLE_CONTEXT_RULES,
  SECTION_KINDS,
  type ArtifactEntry,
  type BuildInput,
} from './types.js';

/**
 * T005–T007：五角色装配矩阵（SC-001）/ 结构性排除（SC-002）/
 * DAG 上游注入 / 预算阶梯（SC-004）/ 优化统计（SC-005）/ 渲染
 * 兼容（`[任务 <id>]` 标记）。
 */

const MISSION_YAML = `
id: c10
goal: 交付特性
planningMode: execution
requirements:
  - text: 需求甲
  - text: 需求乙
plan:
  summary: 方案
tasks:
  - id: probe
    goal: 调查
    agentRole: focus
    dependsOn: []
  - id: probe2
    goal: 深查
    agentRole: focus
    dependsOn: []
  - id: verify
    goal: 取证
    agentRole: insight
    dependsOn: []
  - id: build
    goal: 实现
    agentRole: reason
    dependsOn: [probe, verify]
  - id: audit
    goal: 审阅
    agentRole: wisdom
    dependsOn: []
acceptance:
  - given: 无
    when: 执行
    then: 完成
`;

const mission = loadMission(MISSION_YAML, { sourcePath: '<test>' });

function taskOf(id: string) {
  return mission.tasks!.find((task) => task.id === id)!;
}

function registryWith(
  entries: Array<Partial<ArtifactEntry> & { taskId: string }>,
): RunArtifactRegistry {
  const registry = new RunArtifactRegistry();
  for (const entry of entries) {
    registry.record({
      role: 'focus',
      ok: true,
      output: `产物-${entry.taskId}`,
      ...entry,
    } as ArtifactEntry);
  }
  return registry;
}

function inputOf(taskId: string, extra: Partial<BuildInput> = {}): BuildInput {
  return {
    task: taskOf(taskId),
    mission,
    registry: registryWith([
      { taskId: 'probe', role: 'focus', output: '调查发现：模块 X 耦合 Y' },
      { taskId: 'probe2', role: 'focus', output: '补充发现' },
      { taskId: 'verify', role: 'insight', output: '证据：测试 T 覆盖分支 B' },
    ]),
    ...extra,
  };
}

const builder = new ContextBuilder();

describe('五角色装配矩阵（SC-001）', () => {
  it('reflex：仅 mission/taskGoal（feedback 缺省 unavailable）——最小面', () => {
    const result = builder.build(inputOf('probe')); // probe 是 focus，改用独立 reflex 任务
    const reflexTask = {
      ...taskOf('probe'),
      agentRole: 'reflex' as const,
      dependsOn: [],
    };
    const reflex = builder.build({ ...inputOf('probe'), task: reflexTask });
    const kinds = kindsOf(reflex);
    expect(kinds).toEqual(['feedback', 'mission', 'taskGoal']);
    expect(kinds).not.toContain('findings');
    expect(kinds).not.toContain('diff');
    expect(kinds).not.toContain('validation');
    void result;
  });

  it('focus：source/findings/mission/taskGoal；无依赖兜底全量 findings', () => {
    const result = builder.build(
      inputOf('probe2', { suppliers: { source: 'src/x.ts 摘录' } }),
    );
    expect(kindsOf(result)).toEqual([
      'source',
      'findings',
      'feedback',
      'mission',
      'taskGoal',
    ]);
    const findings = sectionOf(result, 'findings')!;
    expect(findings.unavailable).toBe(false);
    expect(findings.content).toContain('调查发现'); // registry.findings() 兜底
  });

  it('reason：直接上游注入（findings=probe、evidence=verify）+ constraints', () => {
    const result = builder.build(
      inputOf('build', {
        suppliers: { source: '相关源码摘录' },
        mission: mission, // constraints 无 maxTokens → 不强制
      }),
    );
    expect(kindsOf(result)).toEqual([
      'source',
      'evidence',
      'findings',
      'constraints',
      'feedback',
      'mission',
      'taskGoal',
    ]);
    expect(sectionOf(result, 'findings')!.content).toContain('[上游 probe]');
    expect(sectionOf(result, 'evidence')!.content).toContain('[上游 verify]');
    // 直接上游优先：不注入无依赖的 probe2
    expect(sectionOf(result, 'findings')!.content).not.toContain('probe2');
  });

  it('wisdom：diff/validation 经 suppliers 注入 + findings 兜底', () => {
    const result = builder.build(
      inputOf('audit', {
        suppliers: { diff: 'diff --git a/x', validation: 'artifact 摘要' },
      }),
    );
    expect(kindsOf(result)).toEqual([
      'diff',
      'findings',
      'validation',
      'feedback',
      'mission',
      'taskGoal',
    ]);
    expect(sectionOf(result, 'diff')!.content).toContain('diff --git');
  });

  it('上游缺失 → unavailable（不伪造不阻塞）；全 section source 非空', () => {
    const result = builder.build({
      task: { ...taskOf('build'), dependsOn: [] }, // 无依赖 + 空 registry
      mission,
      registry: new RunArtifactRegistry(),
    });
    expect(sectionOf(result, 'findings')!.unavailable).toBe(true);
    expect(sectionOf(result, 'evidence')!.unavailable).toBe(true);
    for (const section of pkgOf(result).sections) {
      expect(section.source.length).toBeGreaterThan(0); // SC-002 运行时面
    }
  });
});

describe('结构性排除（SC-002）', () => {
  it('SECTION_KINDS 闭集外无构造路径；规则表只引用闭集 kind', () => {
    for (const specs of Object.values(ROLE_CONTEXT_RULES)) {
      for (const spec of specs) {
        expect(SECTION_KINDS).toContain(spec.kind);
      }
    }
    // 全量倾倒类型不存在：闭集无 conversation/repository/artifactsDump
    expect(SECTION_KINDS).not.toContain('conversation' as never);
    expect(SECTION_KINDS).not.toContain('fullRepository' as never);
  });
});

describe('预算阶梯（SC-004）', () => {
  const bigFindings = '很长的调查发现。'.repeat(400); // ~2600 chars ≈ 650 tokens

  it('超预算 → 压缩后合规（totalTokens ≤ limit、低优先级先截）', () => {
    const result = builder.build(
      inputOf('build', {
        registry: registryWith([{ taskId: 'probe', output: bigFindings }]),
        suppliers: { source: 'S'.repeat(200) },
        budgetOverride: 260,
      }),
    );
    const pkg = pkgOf(result);
    expect(pkg.totalTokens).toBeLessThanOrEqual(260);
    expect(pkg.compressions).toBeGreaterThanOrEqual(1);
    expect(sectionOf(result, 'source')!.truncated).toBe(true); // priority 2 先截
    expect(sectionOf(result, 'taskGoal')!.truncated).toBe(false); // 高保护
    expect(pkg.optimization.rawTokens).toBeGreaterThan(pkg.totalTokens);
    expect(pkg.optimization.savedRatio).toBeGreaterThan(0);
  });

  it('不可压缩预算 → rejection（轮次 2、逐 section 明细）', () => {
    const result = builder.build(inputOf('build', { budgetOverride: 1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.limit).toBe(1);
      expect(result.rejection.rounds).toBe(2);
      expect(result.rejection.sections.length).toBeGreaterThan(0);
    }
  });

  it('无预算 → 零压缩零报错（只测量）', () => {
    const result = builder.build(
      inputOf('build', {
        registry: registryWith([{ taskId: 'probe', output: bigFindings }]),
      }),
    );
    const pkg = pkgOf(result);
    expect(pkg.compressions).toBe(0);
    expect(pkg.budget.limit).toBeNull();
    for (const section of pkg.sections) {
      expect(section.truncated).toBe(false);
    }
  });

  it('mission 级 maxTokens 生效（task 级优先）', () => {
    const withMissionBudget = loadMission(
      MISSION_YAML.replace(
        'acceptance:',
        'constraints:\n  - kind: maxTokens\n    value: 5000\nacceptance:',
      ),
      { sourcePath: '<test>' },
    );
    const taskBudget = {
      ...taskOf('build'),
      constraints: [{ kind: 'maxTokens' as const, value: 3000 }],
    };
    const result = builder.build({
      task: taskBudget,
      mission: withMissionBudget,
      registry: new RunArtifactRegistry(),
    });
    expect(pkgOf(result).budget).toEqual({ limit: 3000, level: 'task' });

    const missionLevel = builder.build({
      task: taskOf('build'),
      mission: withMissionBudget,
      registry: new RunArtifactRegistry(),
    });
    expect(pkgOf(missionLevel).budget).toEqual({
      limit: 5000,
      level: 'mission',
    });
  });
});

describe('compressSections（确定性 + 头尾保留）', () => {
  it('同输入同输出；截断含 marker 且保留头尾', () => {
    const sections = [
      fakeSection('a', 1, 'A'.repeat(400)),
      fakeSection('b', 9, 'B'.repeat(400)),
    ];
    const first = compressSections(sections, 120, 2, 4);
    const second = compressSections(sections, 120, 2, 4);
    expect(first).toEqual(second); // 确定性复现
    const a = first.sections.find((section) => section.source === 'fake:a')!;
    const b = first.sections.find((section) => section.source === 'fake:b')!;
    expect(a.truncated).toBe(true); // 低优先级先截且轮内全量
    expect(b.truncated).toBe(true);
    expect(a.content).toContain(TRUNCATION_MARKER);
    expect(a.content.startsWith('A')).toBe(true); // 头保留
    expect(a.content.includes('A'.repeat(10))).toBe(true); // 尾保留
    expect(b.content.startsWith('B')).toBe(true);
  });
});

describe('render（渲染兼容）', () => {
  it('`[任务 <id>]` 首行标记 + ## 分节 + 修复反馈行 + unavailable 标注', () => {
    const result = builder.build(
      inputOf('build', { feedback: '请补充测试覆盖' }),
    );
    const text = render(pkgOf(result));
    expect(text.startsWith('[任务 build] 实现')).toBe(true); // 替身 CLI 解析锚
    expect(text).toContain('## mission');
    expect(text).toContain('## findings');
    expect(text).toContain('[修复反馈] 请补充测试覆盖');
    const noDep = builder.build({
      task: { ...taskOf('build'), dependsOn: [] },
      mission,
      registry: new RunArtifactRegistry(),
    });
    expect(render(pkgOf(noDep))).toContain('上游产物不可得');
  });
});

function kindsOf(result: ReturnType<ContextBuilder['build']>): string[] {
  return pkgOf(result).sections.map((section) => section.kind);
}

function pkgOf(result: ReturnType<ContextBuilder['build']>) {
  if (!result.ok) {
    throw new Error('预期 build 成功');
  }
  return result.pkg;
}

function sectionOf(result: ReturnType<ContextBuilder['build']>, kind: string) {
  return pkgOf(result).sections.find((section) => section.kind === kind);
}

function fakeSection(
  kind: string,
  priority: number,
  content: string,
): ContextSectionLike {
  return {
    kind: kind as never,
    source: `fake:${kind}`,
    content,
    sizeTokens: Math.ceil(content.length / 4),
    priority,
    truncated: false,
    unavailable: false,
  };
}

type ContextSectionLike = import('./types.js').ContextSection;
