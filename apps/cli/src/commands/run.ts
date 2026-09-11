import type { Command } from 'commander';

import {
  newEventId,
  serializeEvent,
  stderrLogger,
  type FleetEvent,
} from '@fleet/core';
import {
  FakeRuntimeAdapter,
  runMissionFile,
  type MissionRunOutcome,
  type RunReport,
} from '@fleet/runtime';

/**
 * fleet run — 执行 mission（contracts/cli.md，M6）。
 * 退出码：0 completed（含 autonomous note 态）；1 failed / 文件或
 * 校验错误；2 用法错误。运行时固定 Fake（真实 Adapter 属 M7）。
 */

export function registerRunCommand(program: Command): void {
  program
    .command('run <path>')
    .description('执行 mission：校验 → DAG → 调度 → Fake 五角色 → Run 报告')
    .option('--json', '结构化输出（RunReport）')
    .action(async (missionPath: string, options: { json?: boolean }) => {
      const outcome = await runMissionFile(missionPath, {
        cwd: process.cwd(),
        // CLI 演示用角色画像延迟（reflex 快 → wisdom 慢）；测试经
        // options.runtime 注入零延迟 Fake
        runtime: new FakeRuntimeAdapter(),
        emitEvent: (event) => {
          const fleetEvent: FleetEvent = {
            id: newEventId(),
            type: event.type,
            timestamp: new Date().toISOString(),
            payload: { ...event, type: undefined },
          };
          stderrLogger.debug(serializeEvent(fleetEvent));
        },
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
    });
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
  const lines: string[] = [
    `▶ mission ${run.missionId} · ${run.taskRuns.length} 任务 · fake 运行时`,
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
  lines.push(
    kind === 'completed'
      ? `✓ mission completed · 总耗时 ${report.outcome.durationMs}ms · runId ${run.id.slice(0, 17)}…`
      : `✗ mission failed · 总耗时 ${report.outcome.durationMs}ms · runId ${run.id.slice(0, 17)}…`,
  );
  return lines.join('\n');
}
