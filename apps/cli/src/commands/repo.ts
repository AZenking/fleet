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
    .action(
      async (
        question: string,
        options: {
          repo?: string;
          json?: boolean;
          maxRefs?: number;
          includeGenerated?: boolean;
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
  lines.push('─'.repeat(38));
  lines.push(result.summary);
  return lines.join('\n');
}
