import type { Command } from 'commander';

import {
  RealFileSystem,
  newEventId,
  serializeEvent,
  stderrLogger,
  type FleetEvent,
} from '@fleet/core';
import {
  ExecaWikiGit,
  buildWiki,
  initWiki,
  wikiRootOf,
} from '@fleet/repository';

import { resolveRepoRoot } from './repo.js';

/**
 * fleet wiki — 仓库持久知识层（contracts/cli.md）。
 * 退出码：0 完成（含空结果、幂等重跑、stale 报告）；1 命令自身失败
 * （含 query 时 wiki 缺失/结构损坏）；2 用法错误（commander 默认）。
 */

interface WikiCommandOptions {
  repo?: string;
  json?: boolean;
  force?: boolean;
}

export function registerWikiCommand(program: Command): void {
  const wiki = program
    .command('wiki')
    .description('仓库持久知识层（LLM Wiki）');

  wiki
    .command('init')
    .description('建立 .fleet/wiki 骨架（幂等，不破坏已有内容）')
    .option('--repo <path>', '目标仓库路径（缺省按配置 / cwd 仓库根）')
    .option('--json', '结构化输出')
    .action(async (options: WikiCommandOptions) => {
      const repoRoot = resolveRepoRoot(options.repo);
      const outcome = initWiki(
        new RealFileSystem(),
        repoRoot,
        wikiRootOf(repoRoot),
        () => new Date().toISOString(),
      );
      emitEvent('wiki.init.completed', {
        repoRoot,
        createdCount: outcome.created.length,
      });
      print(
        options.json === true,
        { created: outcome.created },
        outcome.created.length > 0
          ? [
              `已建立 ${outcome.created.length} 个骨架文件：`,
              ...outcome.created.map((file) => `- ${file}`),
            ].join('\n')
          : 'wiki 骨架已存在（幂等，无变更）',
      );
    });

  wiki
    .command('build')
    .description('全量生成 wiki 页面（确定性事实提取，无 LLM）')
    .option('--repo <path>', '目标仓库路径')
    .option('--json', '结构化输出')
    .option('--force', '跳过未变更判断，直接重写全部页面')
    .action(async (options: WikiCommandOptions & { force?: boolean }) => {
      const repoRoot = resolveRepoRoot(options.repo);
      const result = await buildWiki({
        repoRoot,
        fs: new RealFileSystem(),
        git: new ExecaWikiGit(),
        force: options.force === true,
      });
      emitEvent('wiki.build.completed', {
        repoRoot,
        pagesWritten: result.pagesWritten.length,
        pagesUnchanged: result.pagesUnchanged.length,
        valid: result.validation.ok,
        durationMs: result.durationMs,
      });
      print(options.json === true, result, renderWriteResultHuman(result));
    });
}

function emitEvent(type: string, payload: Record<string, unknown>): void {
  const event: FleetEvent = {
    id: newEventId(),
    type,
    timestamp: new Date().toISOString(),
    payload,
  };
  stderrLogger.debug(serializeEvent(event));
}

function print(json: boolean, data: unknown, human: string): void {
  console.log(json ? JSON.stringify(data, null, 2) : human);
}

export function renderWriteResultHuman(result: {
  pagesWritten: string[];
  pagesUnchanged: string[];
  pagesSkipped: string[];
  validation: {
    ok: boolean;
    errors: Array<{ code: string; detail: string; pagePath?: string }>;
  };
  durationMs: number;
}): string {
  const lines: string[] = [
    `写入 ${result.pagesWritten.length} 页 / 未变 ${result.pagesUnchanged.length} / 跳过 ${result.pagesSkipped.length}（${result.durationMs}ms）`,
  ];
  if (result.validation.ok) {
    lines.push('校验：通过（0 错误）');
  } else {
    lines.push(`校验：${result.validation.errors.length} 个错误`);
    for (const error of result.validation.errors) {
      lines.push(
        `- [${error.code}]${error.pagePath !== undefined ? ` ${error.pagePath}：` : '：'}${error.detail}`,
      );
    }
  }
  if (result.pagesSkipped.length > 0) {
    lines.push('⚠ manual 页面已跳过（人工内容优先）：');
    for (const page of result.pagesSkipped) {
      lines.push(`- ${page}`);
    }
  }
  return lines.join('\n');
}
