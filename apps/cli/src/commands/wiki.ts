import path from 'node:path';
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
  computeWikiStatus,
  initWiki,
  queryWiki,
  updateWiki,
  wikiRootOf,
  WikiMissingError,
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

  wiki
    .command('query <question>')
    .description('在 wiki 中检索问题（确定性全文检索，无向量库）')
    .option('--repo <path>', '目标仓库路径')
    .option('--json', '结构化输出')
    .option('--max-hits <number>', '命中条数上限（默认 10）', (value) =>
      Number.parseInt(value, 10),
    )
    .action(
      async (
        question: string,
        options: {
          repo?: string;
          json?: boolean;
          maxHits?: number;
        },
      ) => {
        const repoRoot = resolveRepoRoot(options.repo);
        try {
          const git = new ExecaWikiGit();
          const result = await queryWiki(question, {
            repoRoot,
            fs: new RealFileSystem(),
            git,
            maxHits: options.maxHits,
          });
          // stale 轻量检查（页面级明细归 status）：HEAD ≠ index 锚点即警告
          const staleWarning = await lightStaleWarning(repoRoot, git);
          if (staleWarning !== undefined) {
            console.error(`⚠ ${staleWarning}`);
          }
          emitEvent('wiki.query.completed', {
            repoRoot,
            question,
            hitCount: result.hits.length,
            engine: result.engine,
            durationMs: result.durationMs,
          });
          print(options.json === true, result, renderQueryHuman(result));
        } catch (error) {
          if (error instanceof WikiMissingError) {
            console.error(error.message);
            process.exitCode = 1;
            return;
          }
          throw error;
        }
      },
    );

  wiki
    .command('status')
    .description('报告 wiki 新鲜度（页面级 stale 判定，纯集合运算）')
    .option('--repo <path>', '目标仓库路径')
    .option('--json', '结构化输出')
    .action(async (options: WikiCommandOptions) => {
      const repoRoot = resolveRepoRoot(options.repo);
      const status = await computeWikiStatus({
        repoRoot,
        fs: new RealFileSystem(),
        git: new ExecaWikiGit(),
      });
      emitEvent('wiki.status.completed', {
        repoRoot,
        state: status.state,
        stalePages: status.pages.filter((page) => page.stale).length,
      });
      print(options.json === true, status, renderStatusHuman(status));
    });

  wiki
    .command('update')
    .description('增量重算受影响页面（manual/mixed 保护，未受影响页零触碰）')
    .option('--repo <path>', '目标仓库路径')
    .option('--json', '结构化输出')
    .action(async (options: WikiCommandOptions) => {
      const repoRoot = resolveRepoRoot(options.repo);
      try {
        const result = await updateWiki({
          repoRoot,
          fs: new RealFileSystem(),
          git: new ExecaWikiGit(),
        });
        emitEvent('wiki.update.completed', {
          repoRoot,
          pagesWritten: result.pagesWritten.length,
          pagesSkipped: result.pagesSkipped.length,
          durationMs: result.durationMs,
        });
        const human = renderWriteResultHuman(result);
        print(
          options.json === true,
          result,
          result.note !== undefined ? `${human}\nℹ ${result.note}` : human,
        );
      } catch (error) {
        if (error instanceof WikiMissingError) {
          console.error(error.message);
          process.exitCode = 1;
          return;
        }
        throw error;
      }
    });
}

async function lightStaleWarning(
  repoRoot: string,
  git: ExecaWikiGit,
): Promise<string | undefined> {
  const head = await git.headSha(repoRoot);
  if (!head.ok) {
    return undefined;
  }
  const indexRaw = new RealFileSystem().readFileOptional(
    path.join(wikiRootOf(repoRoot), 'index.md'),
  );
  if (indexRaw === undefined) {
    return undefined;
  }
  const match = /generated_from: ([0-9a-f]{7,40})/.exec(indexRaw);
  const anchored = match?.[1];
  if (anchored !== undefined && anchored !== head.value) {
    return `wiki 已过期（锚点 ${anchored.slice(0, 8)} ≠ HEAD ${head.value.slice(0, 8)}）——建议 fleet wiki update`;
  }
  return undefined;
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

function renderStatusHuman(status: {
  exists: boolean;
  state: string;
  headSha?: string;
  generatedFrom?: string;
  aheadCommits?: number;
  changedFiles: string[];
  pages: Array<{
    path: string;
    origin: string;
    stale: boolean;
    matchedScope: string[];
  }>;
  fullRebuildRecommended: boolean;
}): string {
  if (!status.exists) {
    return 'wiki 不存在——先运行 fleet wiki init && fleet wiki build';
  }
  const lines: string[] = [`状态：${status.state}`];
  if (status.generatedFrom !== undefined) {
    lines.push(
      `锚点：${status.generatedFrom.slice(0, 8)}${
        status.headSha !== undefined
          ? ` → HEAD ${status.headSha.slice(0, 8)}`
          : ''
      }${status.aheadCommits !== undefined ? `（落后 ${status.aheadCommits} 提交）` : ''}`,
    );
  }
  if (status.changedFiles.length > 0) {
    lines.push(`变化文件（${status.changedFiles.length}）：`);
    for (const file of status.changedFiles.slice(0, 20)) {
      lines.push(`- ${file}`);
    }
  }
  const stalePages = status.pages.filter((page) => page.stale);
  if (stalePages.length > 0) {
    lines.push('受影响页面：');
    for (const page of stalePages) {
      lines.push(
        `- ${page.path}（${page.origin}，命中 ${page.matchedScope.join('、') || '.'}）`,
      );
    }
  } else {
    lines.push('受影响页面：无');
  }
  if (status.fullRebuildRecommended) {
    lines.push('ℹ 受影响面过大——建议 fleet wiki build 全量重建');
  }
  return lines.join('\n');
}

function renderQueryHuman(result: {
  question: string;
  hits: Array<{
    pagePath: string;
    title: string;
    snippet: string;
    score: number;
    scoreBreakdown: { title: number; heading: number; body: number };
  }>;
  suggestions: string[];
  engine: string;
  durationMs: number;
}): string {
  const lines = [`问题：${result.question}`];
  if (result.hits.length === 0) {
    lines.push('（wiki 中未找到相关内容）');
    if (result.suggestions.length > 0) {
      lines.push('可用主题：');
      for (const suggestion of result.suggestions) {
        lines.push(`- ${suggestion}`);
      }
    }
  } else {
    result.hits.forEach((hit, index) => {
      lines.push(
        `${String(index + 1).padStart(2)}. [${hit.title}] ${hit.pagePath}（得分 ${hit.score} = 标题${hit.scoreBreakdown.title} + 小节${hit.scoreBreakdown.heading} + 正文${hit.scoreBreakdown.body}）`,
      );
      lines.push(`    ${hit.snippet}`);
    });
  }
  lines.push('─'.repeat(38));
  lines.push(
    `检索引擎：${result.engine}${result.engine === 'walk' ? '（内置遍历）' : ''} · ${result.durationMs}ms`,
  );
  return lines.join('\n');
}
