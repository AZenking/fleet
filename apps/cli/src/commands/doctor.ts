import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import type { Command } from 'commander';
import {
  commandExists,
  findGitRepo,
  FleetError,
  loadFleetConfig,
  satisfiesNodeVersion,
  stderrLogger,
  serializeEvent,
  newEventId,
  type CheckItem,
  type CheckStatus,
  type ConfigIssue,
  type DiagnosticReport,
  type FleetEvent,
} from '@fleet/core';
import { probeRuntime } from '@fleet/runtime';
import pkg from '../../package.json' with { type: 'json' };
import { renderHuman } from '../output/human.js';
import { renderJson } from '../output/json.js';

/**
 * fleet doctor — 环境诊断（contracts/cli.md）。
 *
 * 六项检查按固定顺序输出；不 fail-fast；检查自身崩溃按其失败级别
 * 降级为 warning/error，doctor 进程不崩溃不挂起。
 * CodeGraph / Agent Runtime 恒为 warning 级（宪法原则 I：加速器非硬依赖）。
 */

interface CheckContext {
  cwd: string;
  repoRoot: string | undefined;
}

interface CheckOutcome {
  status: CheckStatus;
  detail: string;
  fixSuggestion?: string;
}

interface CheckDef {
  id: string;
  label: string;
  /** 检查自身抛出异常时降级到的级别 */
  failureSeverity: CheckStatus;
  run: (ctx: CheckContext) => Promise<CheckOutcome>;
}

const AGENT_RUNTIME_NAMES = ['codex', 'gemini', 'pi'] as const;

const CHECKS: readonly CheckDef[] = [
  {
    id: 'node-version',
    label: 'Node 版本',
    failureSeverity: 'error',
    run: () => {
      const range: string = pkg.engines?.node ?? '>=24';
      const current = process.version;
      if (!satisfiesNodeVersion(current, range)) {
        return Promise.resolve({
          status: 'error' as const,
          detail: `${current} 不满足 ${range}`,
          fixSuggestion: `升级 Node 至 ${range}（可用 fnm / nvm 安装 LTS）`,
        });
      }
      return Promise.resolve({
        status: 'ok' as const,
        detail: `${current}（满足 ${range}）`,
      });
    },
  },
  {
    id: 'git-available',
    label: 'Git 可用性',
    failureSeverity: 'error',
    run: async () => {
      if (await commandExists('git'))
        return { status: 'ok', detail: 'git 可用' };
      return {
        status: 'error',
        detail: 'git 命令不存在或不可执行',
        fixSuggestion: '安装 git（brew install git）',
      };
    },
  },
  {
    id: 'git-repo',
    label: 'Git 仓库识别',
    failureSeverity: 'error',
    run: (ctx) => {
      if (ctx.repoRoot) return { status: 'ok', detail: ctx.repoRoot };
      return {
        status: 'error',
        detail: `自 ${ctx.cwd} 向上未找到 .git`,
        fixSuggestion: '在一个 git 仓库内运行 fleet（或先 git init）',
      };
    },
  },
  {
    id: 'fleet-config',
    label: 'Fleet 配置',
    failureSeverity: 'error',
    run: (ctx) => {
      if (!ctx.repoRoot) {
        return {
          status: 'error',
          detail: '无法定位仓库根，跳过配置检查（见 git-repo）',
          fixSuggestion: '先修复 git-repo 检查项',
        };
      }
      const configPath = path.join(ctx.repoRoot, 'configs', 'fleet.yaml');
      let raw: string | undefined;
      try {
        raw = readFileSync(configPath, 'utf8');
      } catch {
        raw = undefined;
      }
      try {
        const config = loadFleetConfig(raw, { sourcePath: configPath });
        return {
          status: 'ok',
          detail: `configs/fleet.yaml（maxConcurrency=${config.defaults.maxConcurrency}，retry=${config.defaults.retry}）`,
        };
      } catch (error) {
        if (error instanceof FleetError) {
          const issues =
            (error.context['issues'] as ConfigIssue[] | undefined) ?? [];
          const issueText = issues
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join('；');
          return {
            status: 'error',
            detail: `${error.message}${issueText ? ` — ${issueText}` : ''}`,
            fixSuggestion: '按 contracts/fleet-yaml.md 修正配置字段',
          };
        }
        throw error;
      }
    },
  },
  {
    id: 'codegraph',
    label: 'CodeGraph',
    failureSeverity: 'warning',
    run: async () => {
      if (await commandExists('codegraph'))
        return { status: 'ok', detail: 'codegraph 可用' };
      return {
        status: 'warning',
        detail: '未安装 — 可降级，不影响 Fleet 可用',
        fixSuggestion: '安装 CodeGraph 可加速调查，但不是必需',
      };
    },
  },
  {
    id: 'agent-runtimes',
    label: 'Agent Runtime',
    failureSeverity: 'warning',
    run: async () => {
      // M7：与 fleet run --runtime 同源探测（probeRuntime）
      const results = await Promise.all(
        AGENT_RUNTIME_NAMES.map((name) => probeRuntime(name)),
      );
      const found = results.filter((r) => r.available);
      if (found.length > 0) {
        return {
          status: 'ok',
          detail: found
            .map((r) => `${r.name}${r.version ? ` ${r.version}` : ''}`)
            .join(' / '),
        };
      }
      const missing = results.filter((r) => !r.available);
      return {
        status: 'warning',
        detail: `未发现 ${AGENT_RUNTIME_NAMES.join('/')} — Fake 运行时仍可执行 mission`,
        fixSuggestion: missing.map((r) => r.installHint).join('；'),
      };
    },
  },
];

export async function runDoctor(cwd: string): Promise<DiagnosticReport> {
  const start = performance.now();

  let repoRoot: string | undefined;
  try {
    repoRoot = findGitRepo(cwd);
  } catch {
    repoRoot = undefined;
  }
  const ctx: CheckContext = { cwd, repoRoot };

  const checks = await Promise.all(
    CHECKS.map(async (def): Promise<CheckItem> => {
      const base = { id: def.id, label: def.label };
      try {
        const outcome = await def.run(ctx);
        return { ...base, ...outcome };
      } catch (error) {
        return {
          ...base,
          status: def.failureSeverity,
          detail: `检查失败：${error instanceof Error ? error.message : String(error)}`,
          fixSuggestion: '请查看详细错误或提交 issue',
        };
      }
    }),
  );

  const errorCount = checks.filter((c) => c.status === 'error').length;
  const warningCount = checks.filter((c) => c.status === 'warning').length;
  const ready = errorCount === 0;
  const summary = ready
    ? warningCount > 0
      ? `环境就绪（${warningCount} 项警告）`
      : '环境就绪'
    : `${errorCount} 项错误需修复${warningCount > 0 ? `（${warningCount} 项警告）` : ''}`;

  const durationMs = Math.round(performance.now() - start);
  const report: DiagnosticReport = { ready, summary, checks, durationMs };

  // T027：doctor.completed 事件走 stderr，不污染 --json 的 stdout
  const event: FleetEvent = {
    id: newEventId(),
    type: 'doctor.completed',
    timestamp: new Date().toISOString(),
    payload: { ready, summary, durationMs },
  };
  stderrLogger.debug(serializeEvent(event));

  return report;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description(
      '环境诊断：Node / Git / 仓库 / 配置 / CodeGraph / Agent Runtime',
    )
    .option('--json', '输出结构化 JSON 报告（与文本模式退出码语义一致）')
    .action(async (options: { json?: boolean }) => {
      const report = await runDoctor(process.cwd());
      console.log(options.json ? renderJson(report) : renderHuman(report));
      if (!report.ready) process.exitCode = 1;
    });
}
