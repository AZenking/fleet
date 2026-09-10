import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Command } from 'commander';
import {
  findGitRepo,
  loadFleetConfig,
  newEventId,
  serializeEvent,
  stderrLogger,
  type FleetEvent,
} from '@fleet/core';
import { investigate, type InvestigationResult } from '@fleet/repository';

/**
 * fleet repo investigate — 仓库调查（contracts/cli.md）。
 * 退出码：0 完成（含未找到）；1 调查自身失败（无法定位仓库）；
 * 2 用法错误（commander 默认）。
 */

export function registerRepoCommand(program: Command): void {
  const repo = program
    .command('repo')
    .description('仓库调查（Repository Intelligence）');

  repo
    .command('investigate <question>')
    .description('调查一个仓库问题；CodeGraph 不可用时自动降级到原生搜索与源码')
    .option('--repo <path>', '目标仓库路径（缺省按配置 / cwd 仓库根）')
    .option('--json', '结构化输出（与文本模式退出码语义一致）')
    .option('--max-refs <number>', '引用条数上限（默认 20）', (value) =>
      Number.parseInt(value, 10),
    )
    .option('--include-generated', '包含生成代码 / 产物目录')
    .option(
      '--mode <mode>',
      '调查模式：auto（默认，高风险自动 verify）/ fast（跳过强制源码复核）/ verify（全链复核）',
      (value: string) => {
        if (value !== 'auto' && value !== 'fast' && value !== 'verify') {
          throw new Error(`无效的 mode：${value}（可选 auto/fast/verify）`);
        }
        return value;
      },
    )
    .action(
      async (
        question: string,
        options: {
          repo?: string;
          json?: boolean;
          maxRefs?: number;
          includeGenerated?: boolean;
          mode?: 'auto' | 'fast' | 'verify';
        },
      ) => {
        let repoRoot: string;
        try {
          repoRoot = resolveRepoRoot(options.repo);
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exitCode = 1;
          return;
        }

        const result = await investigate(question, {
          repoRoot,
          maxRefs: options.maxRefs,
          includeGenerated: options.includeGenerated,
          mode: options.mode,
        });

        const event: FleetEvent = {
          id: newEventId(),
          type: 'repo.investigate.completed',
          timestamp: new Date().toISOString(),
          payload: {
            question,
            degraded: result.degraded,
            pathsUsed: result.pathsUsed,
            referenceCount: result.references.length,
            durationMs: result.durationMs,
            findingsCount: result.findings?.length ?? 0,
            effectiveMode: result.mode?.effectiveMode,
            confidence: result.findings?.[0]?.confidence ?? 'low',
          },
        };
        stderrLogger.debug(serializeEvent(event));

        console.log(options.json ? renderJson(result) : renderHuman(result));
      },
    );
}

export function resolveRepoRoot(explicit?: string): string {
  if (explicit !== undefined) {
    return path.resolve(explicit);
  }
  const root = findGitRepo(process.cwd());
  try {
    const raw = readFileSync(path.join(root, 'configs', 'fleet.yaml'), 'utf8');
    const config = loadFleetConfig(raw);
    return config.repository !== undefined
      ? path.resolve(root, config.repository)
      : root;
  } catch {
    return root;
  }
}

function renderJson(result: InvestigationResult): string {
  return JSON.stringify(result, null, 2);
}

function renderHuman(result: InvestigationResult): string {
  const lines: string[] = [`问题：${result.question}`];
  if (result.references.length === 0) {
    lines.push('（未找到相关内容）');
  }
  result.references.forEach((reference, index) => {
    const symbolText =
      reference.symbol !== undefined
        ? `  ${reference.symbol}${reference.kind !== undefined ? ` (${reference.kind})` : ''}`
        : '';
    lines.push(
      `${String(index + 1).padStart(2)}. ${reference.filePath}:${reference.startLine}${symbolText}`,
    );
    const firstSnippetLine = reference.snippet.split('\n')[0]?.trim();
    if (firstSnippetLine !== undefined && firstSnippetLine !== '') {
      lines.push(`    ${firstSnippetLine}`);
    }
  });
  for (const fallback of result.fallbacks) {
    lines.push(`⚠ 降级(${fallback.code})：${fallback.detail}`);
    if (fallback.fixSuggestion !== undefined) {
      lines.push(`    建议：${fallback.fixSuggestion}`);
    }
  }
  for (const escalation of result.mode?.escalations ?? []) {
    lines.push(`↗ 模式升级(${escalation.rule})：${escalation.detail}`);
  }
  lines.push('─'.repeat(38));
  for (const finding of result.findings ?? []) {
    const counts = new Map<string, number>();
    for (const item of finding.evidence) {
      counts.set(item.source, (counts.get(item.source) ?? 0) + 1);
    }
    const sourceText = [...counts.entries()]
      .map(([source, count]) => `${source}×${count}`)
      .join(' ');
    lines.push(
      `[${finding.confidence}] ${finding.statement}${sourceText !== '' ? `（${sourceText}${finding.truncated === true ? '，已截断' : ''}）` : ''}`,
    );
    for (const conflict of finding.conflicts) {
      lines.push(
        `  ⚠ 冲突(${conflict.kind})：加速源称 ${conflict.accelerated.claim}，源码事实 ${conflict.truth.fact}（static_truth 胜出）`,
      );
    }
  }
  lines.push(result.summary);
  return lines.join('\n');
}
