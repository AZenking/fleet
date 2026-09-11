import type { Command } from 'commander';

import {
  newEventId,
  serializeEvent,
  stderrLogger,
  type FleetEvent,
} from '@fleet/core';
import { validateMissionFile } from '@fleet/mission';

/**
 * fleet mission validate — mission 文件校验（contracts/cli.md）。
 * 退出码：0 通过；1 校验失败或文件不可读；2 用法错误。
 */

export function registerMissionCommand(program: Command): void {
  const mission = program
    .command('mission')
    .description('Fleet Kernel 任务域（mission 校验）');

  mission
    .command('validate <path>')
    .description('校验 mission 文件（schema + 语义，一次报全错误）')
    .option('--json', '结构化输出（MissionValidationReport）')
    .action(async (missionPath: string, options: { json?: boolean }) => {
      const { report } = validateMissionFile(missionPath);

      const event: FleetEvent = {
        id: newEventId(),
        type: 'mission.validated',
        timestamp: new Date().toISOString(),
        payload: {
          path: missionPath,
          ok: report.ok,
          issueCount: report.issues.length,
        },
      };
      stderrLogger.debug(serializeEvent(event));

      if (report.ok && report.mission !== undefined) {
        print(
          options.json === true,
          summaryJson(report),
          renderSummary(report),
        );
        return;
      }
      process.exitCode = 1;
      print(
        options.json === true,
        {
          ok: false,
          ...(report.fileError !== undefined
            ? { fileError: report.fileError }
            : {}),
          issues: report.issues,
        },
        renderFailure(report),
      );
    });
}

function print(json: boolean, data: unknown, human: string): void {
  console.log(json ? JSON.stringify(data, null, 2) : human);
}

interface SummaryShape {
  id: string;
  goal: string;
  planningMode: string;
  taskCount: number;
  acceptanceCount: number;
  constraintCount: number;
}

function summaryJson(report: {
  mission?: {
    id: string;
    goal: string;
    planningMode: string;
    tasks?: unknown[];
    acceptance: unknown[];
    constraints: unknown[];
  };
}): { ok: boolean; summary?: SummaryShape } {
  const mission = report.mission!;
  return {
    ok: true,
    summary: {
      id: mission.id,
      goal: mission.goal,
      planningMode: mission.planningMode,
      taskCount: mission.tasks?.length ?? 0,
      acceptanceCount: mission.acceptance.length,
      constraintCount: mission.constraints.length,
    },
  };
}

function renderSummary(report: Parameters<typeof summaryJson>[0]): string {
  const summary = summaryJson(report).summary!;
  return [
    `✓ mission 校验通过：${summary.id}（${summary.planningMode}）`,
    `  目标：${summary.goal}`,
    `  任务 ${summary.taskCount} · 验收 ${summary.acceptanceCount} · 约束 ${summary.constraintCount}`,
  ].join('\n');
}

function renderFailure(report: {
  fileError?: string;
  issues: Array<{
    path: string;
    expected: string;
    received: string;
    message: string;
  }>;
}): string {
  const lines: string[] = ['✗ mission 校验失败'];
  if (report.fileError !== undefined) {
    lines.push(`  ${report.fileError}`);
  }
  for (const issue of report.issues) {
    lines.push(
      `  [${issue.path}] 期望 ${issue.expected}，实际 ${issue.received}：${issue.message}`,
    );
  }
  if (report.fileError === undefined && report.issues.length === 0) {
    lines.push('  （未知错误：既无文件级故障也无 issues）');
  }
  return lines.join('\n');
}
