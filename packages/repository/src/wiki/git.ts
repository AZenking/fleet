import { execa } from 'execa';

/**
 * wiki 只读 git（research.md D4 前置）。
 *
 * 与 fallback/git.ts 的容错辅助（失败一律返回空）相反：这里失败必须
 * 返回结构化错误——stale 判定的输入是事实依据，静默空结果会让
 * "unknown" 冒充 "fresh"（SC-004 假阳性）。
 */

export type GitOutcome<T> =
  { ok: true; value: T } | { ok: false; error: string };

export interface WikiGitPort {
  /** 当前 HEAD sha；非 git 仓库/命令失败 → ok:false */
  headSha(repoRoot: string): Promise<GitOutcome<string>>;
  /** fromSha..HEAD 间变化的文件（相对仓库根）；失败 → ok:false */
  changedFiles(
    repoRoot: string,
    fromSha: string,
  ): Promise<GitOutcome<string[]>>;
  /** fromSha..HEAD 的提交数；失败 → ok:false */
  aheadCount(repoRoot: string, fromSha: string): Promise<GitOutcome<number>>;
}

async function runGit(
  repoRoot: string,
  args: string[],
): Promise<GitOutcome<string>> {
  try {
    const result = await execa('git', args, {
      cwd: repoRoot,
      timeout: 3000,
      reject: false,
      stdin: 'ignore',
    });
    if (result.exitCode !== 0) {
      return {
        ok: false,
        error: `git ${args[0] ?? ''} 退出码 ${result.exitCode}：${firstLine(result.stderr || result.stdout)}`,
      };
    }
    return { ok: true, value: result.stdout };
  } catch (error) {
    return {
      ok: false,
      error: `git ${args[0] ?? ''} 执行失败：${errorMessage(error)}`,
    };
  }
}

export class ExecaWikiGit implements WikiGitPort {
  async headSha(repoRoot: string): Promise<GitOutcome<string>> {
    const result = await runGit(repoRoot, ['rev-parse', 'HEAD']);
    return result.ok
      ? { ok: true, value: result.value.trim() }
      : { ok: false, error: `无法获取 HEAD（${repoRoot}）：${result.error}` };
  }

  async changedFiles(
    repoRoot: string,
    fromSha: string,
  ): Promise<GitOutcome<string[]>> {
    const result = await runGit(repoRoot, [
      'diff',
      '--name-only',
      fromSha,
      'HEAD',
    ]);
    if (!result.ok) {
      return {
        ok: false,
        error: `无法计算 diff（${fromSha}..HEAD）：${result.error}`,
      };
    }
    return {
      ok: true,
      value: result.value
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    };
  }

  async aheadCount(
    repoRoot: string,
    fromSha: string,
  ): Promise<GitOutcome<number>> {
    const result = await runGit(repoRoot, [
      'rev-list',
      '--count',
      `${fromSha}..HEAD`,
    ]);
    if (!result.ok) {
      return { ok: false, error: `无法统计领先提交：${result.error}` };
    }
    const count = Number.parseInt(result.value.trim(), 10);
    return Number.isFinite(count)
      ? { ok: true, value: count }
      : {
          ok: false,
          error: `git rev-list 输出不可解析：${result.value.trim()}`,
        };
  }
}

/** 假实现（单元测试注入：脚本化成功/失败/非 git 场景） */
export class FakeWikiGit implements WikiGitPort {
  constructor(
    private readonly script: {
      headSha?: string | Error;
      changedFiles?: string[] | Error;
      aheadCount?: number | Error;
    },
  ) {}

  async headSha(): Promise<GitOutcome<string>> {
    const value = this.script.headSha;
    if (value instanceof Error) {
      return { ok: false, error: value.message };
    }
    return value === undefined
      ? { ok: false, error: '非 git 仓库' }
      : { ok: true, value };
  }

  async changedFiles(
    _repoRoot: string,
    fromSha: string,
  ): Promise<GitOutcome<string[]>> {
    const value = this.script.changedFiles;
    if (value instanceof Error) {
      return { ok: false, error: value.message };
    }
    return value === undefined
      ? { ok: false, error: `无法计算 diff（${fromSha}..HEAD）` }
      : { ok: true, value };
  }

  async aheadCount(): Promise<GitOutcome<number>> {
    const value = this.script.aheadCount;
    if (value instanceof Error) {
      return { ok: false, error: value.message };
    }
    return value === undefined
      ? { ok: false, error: '无法统计领先提交' }
      : { ok: true, value };
  }
}

function firstLine(text: string): string {
  return text.split('\n')[0]?.trim() ?? '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
