import { CONFIG_EXTENSIONS } from '../investigation/policy.js';
import type { Reference } from '../investigation/types.js';
import { evaluateConfidence } from './confidence.js';
import {
  MAX_EVIDENCE_PER_FINDING,
  type EffectiveMode,
  type Evidence,
  type EvidenceConflict,
  type EvidenceSource,
  type Finding,
} from './types.js';

/**
 * Finding 合成（research.md D1 / FR-001/009/010）：
 * 确定性模板——符号组 / 文件组 / wiki 组 / insufficient；
 * statement 是模板拼接而非理解（宪法 V），同输入同输出（SC-003）。
 * config 重分类（D5）：配置扩展名命中的引用 → source=config。
 */

export interface ResolverInput {
  /** planner 的符号清单（符号 finding 的分组键） */
  symbols: string[];
  references: Reference[];
  /** wiki 证据（US3 接入；缺失时无 wiki finding） */
  wikiEvidence?: Evidence[];
  /** wiki 死路径冲突（挂靠 wiki finding） */
  wikiConflicts?: EvidenceConflict[];
  /** 锚点偏移冲突（挂靠符号/文件组 finding） */
  anchorConflicts?: AnchorConflictAttachment[];
  mode: EffectiveMode;
  maxEvidence?: number;
}

export interface AnchorConflictAttachment {
  filePath: string;
  symbol?: string;
  conflict: EvidenceConflict;
}

/** Reference → Evidence（config 扩展名重分类，research.md D5） */
export function toEvidence(reference: Reference): Evidence {
  const isConfig = CONFIG_EXTENSIONS.some((ext) =>
    reference.filePath.endsWith(ext),
  );
  const source: EvidenceSource = isConfig
    ? 'config'
    : reference.origin === 'codegraph'
      ? 'codegraph'
      : reference.origin === 'search'
        ? 'search'
        : 'source';
  return {
    source,
    location: `${reference.filePath}:${reference.startLine}`,
    excerpt: firstLine(reference.snippet),
    verified: reference.verified,
    ...(reference.symbol !== undefined ? { symbol: reference.symbol } : {}),
  };
}

export function resolveFindings(input: ResolverInput): Finding[] {
  const max = input.maxEvidence ?? MAX_EVIDENCE_PER_FINDING;
  const findings: Finding[] = [];

  // —— 符号 finding（planner 符号顺序）——
  const claimed = new Set<string>();
  for (const symbol of input.symbols) {
    const refs = input.references.filter(
      (reference) => reference.symbol === symbol,
    );
    if (refs.length === 0) {
      continue;
    }
    for (const reference of refs) {
      claimed.add(referenceKey(reference));
    }
    const first = refs[0]!;
    findings.push(
      finalize(
        {
          kind: 'symbol',
          statement: `「${symbol}」共 ${refs.length} 处引用（首处 ${first.filePath}:${first.startLine}）`,
          evidence: refs.map(toEvidence),
          conflicts: attachConflicts(input.anchorConflicts ?? [], refs),
        },
        max,
        input.mode,
      ),
    );
  }

  // —— 文件组 finding（剩余引用按顶层目录归组）——
  const leftovers = input.references.filter(
    (reference) => !claimed.has(referenceKey(reference)),
  );
  const clusters = new Map<string, Reference[]>();
  for (const reference of leftovers) {
    const dir = reference.filePath.includes('/')
      ? (reference.filePath.split('/')[0] ?? '')
      : '（仓库根）';
    const group = clusters.get(dir) ?? [];
    group.push(reference);
    clusters.set(dir, group);
  }
  for (const [dir, refs] of [...clusters.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    findings.push(
      finalize(
        {
          kind: 'file-cluster',
          statement: `关键词在 ${dir} 命中 ${refs.length} 处`,
          evidence: refs.map(toEvidence),
          conflicts: attachConflicts(input.anchorConflicts ?? [], refs),
        },
        max,
        input.mode,
      ),
    );
  }

  // —— wiki finding ——
  if ((input.wikiEvidence?.length ?? 0) > 0) {
    const wikiEvidence = input.wikiEvidence ?? [];
    const pages = [...new Set(wikiEvidence.map((item) => item.location))].slice(
      0,
      3,
    );
    findings.push(
      finalize(
        {
          kind: 'wiki',
          statement: `仓库知识层（wiki）中 ${new Set(wikiEvidence.map((item) => item.location)).size} 页与问题相关（${pages.join('、')}）`,
          evidence: wikiEvidence,
          conflicts: input.wikiConflicts ?? [],
        },
        max,
        input.mode,
      ),
    );
  }

  // —— insufficient finding（FR-009：不产出无据 statement）——
  if (findings.length === 0) {
    findings.push({
      kind: 'insufficient',
      statement: '未找到可支撑结论的证据（insufficient）',
      evidence: [],
      confidence: 'low',
      confidenceReason: 'insufficient：无可用证据',
      conflicts: [],
    });
  }

  return findings;
}

interface DraftFinding {
  kind: Finding['kind'];
  statement: string;
  evidence: Evidence[];
  conflicts: EvidenceConflict[];
}

function finalize(
  draft: DraftFinding,
  max: number,
  mode: EffectiveMode,
): Finding {
  const truncated = draft.evidence.length > max;
  const evidence = truncated ? draft.evidence.slice(0, max) : draft.evidence;
  const outcome = evaluateConfidence({
    evidence,
    conflicts: draft.conflicts,
    mode,
  });
  return {
    kind: draft.kind,
    statement: draft.statement,
    evidence,
    confidence: outcome.confidence,
    confidenceReason: outcome.reason,
    conflicts: draft.conflicts,
    ...(truncated ? { truncated: true } : {}),
  };
}

/** 冲突按文件路径挂靠到包含该文件的 finding（符号 finding 优先命中） */
function attachConflicts(
  attachments: AnchorConflictAttachment[],
  refs: Reference[],
): EvidenceConflict[] {
  const paths = new Set(refs.map((ref) => ref.filePath));
  return attachments
    .filter((attachment) => paths.has(attachment.filePath))
    .map((attachment) => attachment.conflict);
}

function referenceKey(reference: Reference): string {
  return `${reference.filePath}:${reference.startLine}:${reference.symbol ?? ''}`;
}

function firstLine(text: string): string {
  const line = text.split('\n')[0] ?? '';
  return line.length > 160 ? `${line.slice(0, 160)}…` : line;
}
