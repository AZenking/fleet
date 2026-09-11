import { createId } from '@fleet/core';
import { execa } from 'execa';
import type { WorkspaceManager } from '@fleet/workspace';

import {
  COMMAND_KINDS,
  type ArtifactOverall,
  type CommandKind,
  type DiffStat,
  type ValidationArtifact,
  type ValidationCheck,
  type ValidationInput,
  type ValidationProfile,
} from './types.js';

/**
 * ValidationRunner（research.md D4，宪法 III 核心落点）：
 * 在任务隔离 worktree 上独立执行四类检查——diff（M8 getDiff 语义）
 * 先行确立变更面（空 → noop 短路），lint/typecheck/tests 为受控
 * 子进程（顺序执行不短路、超时诚实、输出头尾截断）。Runner 不在
 * 实现者进程内执行、不读实现者任何输出——判定路径纯净性是
 * SC-001 的断言对象。
 */

const EXCERPT_HEAD = 2048;
const EXCERPT_TAIL = 2048;

export interface ValidationRunnerConfig {
  manager: WorkspaceManager;
  profile: ValidationProfile;
}

export class ValidationRunner {
  constructor(private readonly config: ValidationRunnerConfig) {}

  async validate(input: ValidationInput): Promise<ValidationArtifact> {
    const diffStarted = Date.now();
    let diff: string;
    let diffCheck: ValidationCheck;
    try {
      diff = await this.config.manager.getDiff(input.workspace);
      diffCheck = {
        kind: 'diff',
        status: 'pass',
        outputExcerpt: excerptOf(diff),
        durationMs: Date.now() - diffStarted,
        evidence: 'config',
        required: true,
      };
    } catch (error) {
      diff = '';
      diffCheck = {
        kind: 'diff',
        status: 'fail',
        outputExcerpt: excerptOf(
          `git diff 失败：${error instanceof Error ? error.message : String(error)}`,
        ),
        durationMs: Date.now() - diffStarted,
        evidence: 'config',
        required: true,
      };
    }

    const empty = diff.trim().length === 0;
    const checks: ValidationCheck[] = [diffCheck];
    for (const kind of COMMAND_KINDS) {
      if (empty) {
        checks.push(skippedCheck(kind, 'empty-diff'));
        continue;
      }
      const { command } = this.config.profile.checks[kind];
      if (command === undefined) {
        checks.push(skippedCheck(kind, 'not-configured'));
        continue;
      }
      checks.push(
        await runCheck(
          kind,
          command,
          input.workspace.path,
          this.config.profile.timeoutMs,
        ),
      );
    }

    return {
      id: createId('art_'),
      taskId: input.taskId,
      runId: input.runId ?? 'adhoc',
      workspaceRef: input.workspace.path,
      loop: input.loop,
      checks,
      overall: overallOf(empty, checks),
      diffStat: statOf(diff),
      createdAt: new Date().toISOString(),
    };
  }
}

function skippedCheck(kind: CommandKind, reason: string): ValidationCheck {
  return {
    kind,
    status: 'skipped',
    outputExcerpt: '',
    durationMs: 0,
    evidence: kind === 'tests' ? 'test' : 'runtime',
    skipReason: reason,
    required: false,
  };
}

async function runCheck(
  kind: CommandKind,
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<ValidationCheck> {
  const started = Date.now();
  try {
    const result = await execa(command, {
      shell: true,
      cwd,
      timeout: timeoutMs,
      reject: false,
      all: true,
    });
    const output = String(result.all ?? '');
    if (result.timedOut === true) {
      return {
        kind,
        command,
        status: 'timeout',
        outputExcerpt: excerptOf(
          `${output}\n[超时 @ ${Date.now() - started}ms]`,
        ),
        durationMs: Date.now() - started,
        evidence: kind === 'tests' ? 'test' : 'runtime',
        required: true,
      };
    }
    return {
      kind,
      command,
      status: result.exitCode === 0 ? 'pass' : 'fail',
      exitCode: result.exitCode,
      outputExcerpt: excerptOf(output),
      durationMs: Date.now() - started,
      evidence: kind === 'tests' ? 'test' : 'runtime',
      required: true,
    };
  } catch (error) {
    // 命令不存在 / 无法启动（shell 层错误）→ 按该检查 fail
    return {
      kind,
      command,
      status: 'fail',
      outputExcerpt: excerptOf(
        `命令无法执行：${error instanceof Error ? error.message : String(error)}`,
      ),
      durationMs: Date.now() - started,
      evidence: kind === 'tests' ? 'test' : 'runtime',
      required: true,
    };
  }
}

function overallOf(empty: boolean, checks: ValidationCheck[]): ArtifactOverall {
  if (empty) {
    return 'noop';
  }
  return checks.some(
    (check) =>
      check.required && (check.status === 'fail' || check.status === 'timeout'),
  )
    ? 'fail'
    : 'pass';
}

/** 头 2KB + 尾 2KB 截断（错误通常在尾部）+ 标注 */
export function excerptOf(text: string): string {
  if (text.length <= EXCERPT_HEAD + EXCERPT_TAIL) {
    return text;
  }
  const head = text.slice(0, EXCERPT_HEAD);
  const tail = text.slice(-EXCERPT_TAIL);
  const omitted = text.length - head.length - tail.length;
  return `${head}\n[…已截断 ${omitted} 字符…]\n${tail}`;
}

/** unified diff 统计（ReviewPackage 引用语义——不内联全文） */
export function statOf(diff: string): DiffStat {
  let files = 0;
  let insertions = 0;
  let deletions = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      files += 1; // Binary 标记行跟随 header 出现，不重复计数
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      insertions += 1;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      deletions += 1;
    }
  }
  return { files, insertions, deletions };
}
