import path from 'node:path';
import { execa } from 'execa';
import type { FileSystemPort } from '@fleet/core';

/**
 * 原生搜索（research.md D2）：ripgrep 优先，缺失/失败降级为内置文件遍历。
 * 最终兜底是文件系统本身（spec US2 场景 4）。
 */

export interface SearchHit {
  filePath: string;
  lineNumber: number;
  lineText: string;
  engine: 'ripgrep' | 'walk';
}

export interface SearchOutcome {
  hits: SearchHit[];
  engine: 'ripgrep' | 'walk';
  /** rg 不可用而降级为 walk 时为 true */
  degraded: boolean;
}

export interface SearchOptions {
  repoRoot: string;
  patterns: string[];
  fs: FileSystemPort;
  includeGenerated?: boolean;
  maxHits?: number;
  timeoutMs?: number;
  /** rg 命令名（测试可替换为不存在的命令以触发降级） */
  rgCommand?: string;
  /** 强制使用内置遍历（测试确定性；不算 degraded） */
  forceWalk?: boolean;
}

export const DEFAULT_EXCLUDED_DIRS = [
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.codegraph',
  '.fleet',
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseRipgrepJson(stdout: string, maxHits: number): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const record = event as {
      type?: string;
      data?: {
        path?: { text?: unknown };
        line_number?: unknown;
        lines?: { text?: unknown };
      };
    };
    if (record?.type !== 'match') {
      continue;
    }
    const filePath = record.data?.path?.text;
    const lineNumber = record.data?.line_number;
    const lineText = record.data?.lines?.text;
    if (
      typeof filePath === 'string' &&
      typeof lineNumber === 'number' &&
      typeof lineText === 'string'
    ) {
      hits.push({
        // rg 以 '.' 为搜索根时路径带 ./ 前缀，统一去掉
        filePath: filePath.replace(/^\.\//, ''),
        lineNumber,
        lineText: lineText.trimEnd(),
        engine: 'ripgrep',
      });
      if (hits.length >= maxHits) {
        break;
      }
    }
  }
  return hits;
}

async function tryRipgrep(
  options: SearchOptions,
  maxHits: number,
): Promise<SearchHit[] | undefined> {
  const args: string[] = ['--json', '--no-messages'];
  for (const pattern of options.patterns) {
    args.push('-e', pattern);
  }
  if (options.includeGenerated !== true) {
    for (const dir of DEFAULT_EXCLUDED_DIRS) {
      args.push('--glob', `!${dir}/**`);
    }
  }
  args.push('--max-count', '20');
  // 显式路径 + stdin 关闭：不给路径参数时 rg 会等待管道 stdin 而挂起
  args.push('.');
  try {
    const result = await execa(options.rgCommand ?? 'rg', args, {
      cwd: options.repoRoot,
      timeout: options.timeoutMs ?? 3000,
      reject: false,
      stdin: 'ignore',
    });
    if (result.timedOut || result.exitCode === 2) {
      return undefined;
    }
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      return undefined;
    }
    return parseRipgrepJson(result.stdout, maxHits);
  } catch {
    return undefined;
  }
}

export async function walkSearch(
  options: SearchOptions,
  maxHits: number,
): Promise<SearchHit[]> {
  const hits: SearchHit[] = [];
  const regexes = options.patterns.map(
    (pattern) => new RegExp(escapeRegExp(pattern)),
  );
  const excluded = new Set(
    options.includeGenerated === true ? ['.git'] : DEFAULT_EXCLUDED_DIRS,
  );

  const visit = (relativeDir: string): void => {
    if (hits.length >= maxHits) {
      return;
    }
    let entries: string[];
    try {
      entries = options.fs.listDir(path.join(options.repoRoot, relativeDir));
    } catch {
      return;
    }
    for (const entry of entries) {
      if (hits.length >= maxHits) {
        return;
      }
      if (excluded.has(entry)) {
        continue;
      }
      const relative = relativeDir === '' ? entry : `${relativeDir}/${entry}`;
      let content: string | undefined;
      try {
        content = options.fs.readFile(path.join(options.repoRoot, relative));
      } catch {
        content = undefined;
      }
      if (content !== undefined) {
        const lines = content.split('\n');
        let fileHits = 0;
        for (let index = 0; index < lines.length && fileHits < 3; index++) {
          const line = lines[index] ?? '';
          if (regexes.some((regex) => regex.test(line))) {
            hits.push({
              filePath: relative,
              lineNumber: index + 1,
              lineText: line.trimEnd(),
              engine: 'walk',
            });
            fileHits += 1;
            if (hits.length >= maxHits) {
              return;
            }
          }
        }
      } else {
        visit(relative);
      }
    }
  };

  visit('');
  return hits;
}

export async function searchPatterns(
  options: SearchOptions,
): Promise<SearchOutcome> {
  const maxHits = options.maxHits ?? 100;
  if (options.patterns.length === 0) {
    return { hits: [], engine: 'walk', degraded: false };
  }
  if (options.forceWalk === true) {
    return {
      hits: await walkSearch(options, maxHits),
      engine: 'walk',
      degraded: false,
    };
  }
  const ripgrep = await tryRipgrep(options, maxHits);
  if (ripgrep !== undefined) {
    return { hits: ripgrep, engine: 'ripgrep', degraded: false };
  }
  return {
    hits: await walkSearch(options, maxHits),
    engine: 'walk',
    degraded: true,
  };
}
