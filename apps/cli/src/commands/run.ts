import type { Command } from 'commander';

import {
  commandExists,
  newEventId,
  serializeEvent,
  stderrLogger,
  type FleetEvent,
} from '@fleet/core';
import {
  CliRuntimeAdapter,
  FakeRuntimeAdapter,
  probeRuntime,
  runMissionFile,
  type MissionRunOutcome,
  type RunReport,
} from '@fleet/runtime';
import {
  AgentTaskExecutor,
  RuntimeRegistry,
  knownRuntimeNames,
  registerRuntimeFactory,
} from '@fleet/agents';
import type { AgentRole, Mission, Task } from '@fleet/mission';
import {
  GitWorktreeManager,
  WorkspaceResolvingExecutor,
} from '@fleet/workspace';
import {
  AgentReviewer,
  ValidationReviewGate,
  ValidationRunner,
  resolveValidationProfile,
} from '@fleet/validation';
import type { TaskExecutor } from '@fleet/scheduler';
import type { ValidationEvent } from '@fleet/validation';
import { permissionOf } from '@fleet/runtime';

/**
 * fleet run — 执行 mission（contracts/cli.md，M6/M7/M8/M9）。
 * 退出码：0 completed（含 autonomous note 态）；1 failed / 文件或
 * 校验错误 / 显式运行时不可用；2 用法错误。
 * --runtime：name（全体）或 role=name（单角色覆盖），可重复；
 * 缺省全 Fake。显式指定的真实运行时不可用 → 报错，不静默降级。
 * M9：--no-validation-gate 关闭验证门（回退 M8 auto 处置）；
 * 门默认开且仅 worktree 模式生效（--no-worktree = M7 直通）。
 */

const ALL_ROLES: readonly AgentRole[] = [
  'reflex',
  'focus',
  'reason',
  'insight',
  'wisdom',
];

export function registerRunCommand(program: Command): void {
  program
    .command('run <path>')
    .description('执行 mission：校验 → DAG → 调度 → Agent 角色 → Run 报告')
    .option('--json', '结构化输出（RunReport）')
    .option(
      '--runtime <spec>',
      '运行时选择：name（全体）或 role=name（单角色覆盖），可重复；缺省 fake',
      (value: string, previous: string[]) => [...previous, value],
      [] as string[],
    )
    .option(
      '--no-worktree',
      '关闭 worktree 物理隔离（写角色直接在主仓根执行——回到 M7 行为）',
    )
    .option(
      '--no-validation-gate',
      '关闭 M9 验证门（回退 M8 auto 处置：成功即合，无独立验证/审阅）',
    )
    .action(
      async (
        missionPath: string,
        options: {
          json?: boolean;
          runtime?: string[];
          worktree?: boolean;
          validationGate?: boolean;
        },
      ) => {
        const specs = options.runtime ?? [];

        // 显式运行时探测：不可用即报错（不静默降级，FR-007）
        if (specs.length > 0) {
          // 未注册名若在 PATH 可达 → 自动注册为 CLI 适配器（替身 /
          // 用户自有 CLI）；不可达则由 fromSpec 报未知运行时
          const known = knownRuntimeNames();
          const unknownNames = [
            ...new Set(
              specs
                .map((spec) => /^([a-z]+)=(.+)$/.exec(spec)?.[2] ?? spec)
                .filter((name) => !known.includes(name)),
            ),
          ];
          for (const name of unknownNames) {
            if (await commandExists(name)) {
              registerRuntimeFactory(
                name,
                () =>
                  new CliRuntimeAdapter({
                    name,
                    command: name,
                    buildArgs: (request) => [request.prompt],
                  }),
              );
            }
          }

          let registry: RuntimeRegistry;
          try {
            registry = RuntimeRegistry.fromSpec(specs);
          } catch (error) {
            console.error(
              error instanceof Error ? error.message : String(error),
            );
            process.exitCode = 2;
            return;
          }
          const failures: string[] = [];
          for (const role of ALL_ROLES) {
            const adapter = registry.resolve(role);
            if (adapter instanceof FakeRuntimeAdapter) {
              continue;
            }
            const availability = await probeRuntime(
              adapter as CliRuntimeAdapter,
            );
            if (!availability.available) {
              failures.push(
                `  ${role} → ${availability.name}：${availability.installHint}`,
              );
            }
          }
          if (failures.length > 0) {
            console.error('✗ 显式指定的运行时不可用（不静默降级为 fake）：');
            for (const failure of failures) {
              console.error(failure);
            }
            process.exitCode = 1;
            return;
          }
        }

        const useWorktree = options.worktree !== false;
        const useGate = options.validationGate !== false && useWorktree;
        const emitFleetEvent = (event: { type: string }): void => {
          const fleetEvent: FleetEvent = {
            id: newEventId(),
            type: event.type,
            timestamp: new Date().toISOString(),
            payload: { ...event, type: undefined },
          };
          stderrLogger.debug(serializeEvent(fleetEvent));
        };
        const outcome = await runMissionFile(missionPath, {
          cwd: process.cwd(),
          ...(specs.length === 0 && !useWorktree
            ? { runtime: new FakeRuntimeAdapter() }
            : {
                makeExecutor: (mission: Mission) =>
                  buildExecutor(mission, specs, {
                    useWorktree,
                    useGate,
                    emitGateEvent: (event: ValidationEvent) =>
                      emitFleetEvent(event),
                  }),
              }),
          emitEvent: (event) => emitFleetEvent(event),
        });

        if (outcome.kind === 'invalid') {
          process.exitCode = 1;
          print(
            options.json === true,
            outcome.validation,
            renderInvalid(outcome),
          );
          return;
        }
        if (outcome.kind === 'failed') {
          process.exitCode = 1;
        }
        print(
          options.json === true,
          outcome.report,
          renderReport(outcome.kind, outcome.report),
        );
      },
    );
}

function print(json: boolean, data: unknown, human: string): void {
  console.log(json ? JSON.stringify(data, null, 2) : human);
}

function renderInvalid(
  outcome: Extract<MissionRunOutcome, { kind: 'invalid' }>,
): string {
  const validation = outcome.validation;
  const lines = ['✗ mission 校验失败，未执行任何任务'];
  if (validation.fileError !== undefined) {
    lines.push(`  ${validation.fileError}`);
  }
  for (const issue of validation.issues) {
    lines.push(
      `  [${issue.path}] 期望 ${issue.expected}，实际 ${issue.received}：${issue.message}`,
    );
  }
  return lines.join('\n');
}

function renderReport(kind: 'completed' | 'failed', report: RunReport): string {
  const run = report.run;
  const runtimeText =
    report.runtime.runtimes !== undefined
      ? Object.entries(report.runtime.runtimes)
          .map(([role, name]) => `${role}=${name}`)
          .join(' ')
      : `${report.runtime.adapter} 运行时`;
  const lines: string[] = [
    `▶ mission ${run.missionId} · ${run.taskRuns.length} 任务 · ${runtimeText}`,
  ];
  if (report.note !== undefined) {
    lines.push(`ℹ ${report.note}`);
  }
  lines.push('  任务表：');
  for (const taskRun of run.taskRuns) {
    const outcomeNode = report.outcome.nodes.find(
      (node) => node.taskId === taskRun.taskId,
    );
    const attempts = outcomeNode?.attempts ?? 0;
    const suffix =
      taskRun.status === 'failed'
        ? `  ${attempts} 次  ${outcomeNode?.failureReason ?? ''}`
        : taskRun.status === 'skipped'
          ? `  ← 由 ${outcomeNode?.skippedBy ?? '?'} 失败传播`
          : `  ${attempts} 次`;
    lines.push(
      `    ${taskRun.taskId.padEnd(20)} ${taskRun.agentRole.padEnd(8)} ${taskRun.status}${suffix}`,
    );
  }
  for (const chain of report.outcome.propagation) {
    lines.push(
      `  传播：${chain.failedTaskId} 失败 → ${chain.skipped.join('、')} 跳过`,
    );
  }
  if (report.reviews !== undefined) {
    lines.push('  验证门：');
    for (const entry of report.reviews) {
      const review = entry as {
        taskId: string;
        terminal: string;
        rounds: number;
        maxReviewLoops: number;
        verdicts?: Array<{ verdict: string }>;
      };
      const last = review.verdicts?.at(-1)?.verdict ?? '—';
      lines.push(
        `    ${review.taskId.padEnd(20)} ${review.terminal} · 修复 ${review.rounds}/${review.maxReviewLoops} 轮 · 末次审阅 ${last}`,
      );
    }
  }
  if (report.workspaces !== undefined) {
    lines.push('  工作区：');
    for (const ws of report.workspaces) {
      lines.push(
        `    ${ws.taskId.padEnd(20)} ${ws.action}${ws.outcome !== undefined ? `（${ws.outcome}）` : ''}${ws.detail !== undefined ? ` ${ws.detail}` : ''}`,
      );
    }
  }
  lines.push(
    kind === 'completed'
      ? `✓ mission completed · 总耗时 ${report.outcome.durationMs}ms · runId ${run.id.slice(0, 17)}…`
      : `✗ mission failed · 总耗时 ${report.outcome.durationMs}ms · runId ${run.id.slice(0, 17)}…`,
  );
  return lines.join('\n');
}

/** M8/M9 装配：worktree 集成（写角色建区/处置）+ 验证门（可选）或 M7 直通 */
function buildExecutor(
  mission: Mission,
  specs: string[],
  options: {
    useWorktree: boolean;
    useGate: boolean;
    emitGateEvent: (event: ValidationEvent) => void;
  },
): TaskExecutor {
  const registry = RuntimeRegistry.fromSpec(specs);
  if (!options.useWorktree) {
    return new AgentTaskExecutor({
      registry,
      cwd: process.cwd(),
      missionMaxDurationMs: mission.constraints.find(
        (constraint) => constraint.kind === 'maxDurationMs',
      )?.value,
    });
  }
  const manager = new GitWorktreeManager(process.cwd());
  const wrapperRef: { current?: WorkspaceResolvingExecutor } = {};
  const wrapper = new WorkspaceResolvingExecutor({
    inner: new AgentTaskExecutor({
      registry,
      cwd: (task: Task) => wrapperRef.current!.cwdResolver(task),
      missionMaxDurationMs: mission.constraints.find(
        (constraint) => constraint.kind === 'maxDurationMs',
      )?.value,
    }),
    manager,
    repoRoot: process.cwd(),
    runId: `run_ws_${mission.id}`,
    ...(options.useGate
      ? {
          gate: new ValidationReviewGate({
            runner: new ValidationRunner({
              manager,
              profile: resolveValidationProfile(mission, process.cwd()),
            }),
            reviewer: new AgentReviewer({
              adapter: registry.resolve('wisdom'),
              repoRoot: process.cwd(),
            }),
            profile: resolveValidationProfile(mission, process.cwd()),
            missionGoal: mission.goal,
            runId: `run_ws_${mission.id}`,
            emitEvent: options.emitGateEvent,
          }),
        }
      : {}),
  });
  wrapperRef.current = wrapper;
  void permissionOf;
  return wrapper;
}
