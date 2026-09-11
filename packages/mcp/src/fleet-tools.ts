import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { validateMissionContent } from '@fleet/mission';
import {
  EventSink,
  RunStore,
  latestRunDir,
  readSummaryFile,
  viewRun,
} from '@fleet/observability';
import { runMissionFile } from '@fleet/runtime';

import type { ToolDefinition, ToolResult } from './types.js';

/**
 * Fleet 五工具（research.md D4/D5）：全部既有接缝直通——
 * create=校验+落盘 / run=runMissionFile 全链（M9-M11 语义自动
 * 同源）/ status=M11 视图 / result=Review Package 聚合 /
 * cancel=M11 标记通道。MCP 面只暴露产品级动作（运行时选择属
 * 调用方环境配置，不进协议）。
 */

export interface FleetToolsOptions {
  /** mission 落盘目录（缺省 <repoRoot>/.fleet/missions） */
  missionsDir?: string;
  /** fleet_run 的执行根（缺省 process.cwd()） */
  repoRoot?: string;
}

function strOf(args: Record<string, unknown>, key: string): string {
  return typeof args[key] === 'string' ? (args[key] as string) : '';
}

export function buildFleetTools(
  options: FleetToolsOptions = {},
): ToolDefinition[] {
  const repoRoot = options.repoRoot ?? process.cwd();
  const missionsDir =
    options.missionsDir ?? path.join(repoRoot, '.fleet', 'missions');
  const store = new RunStore(repoRoot);

  return [
    {
      name: 'fleet_create_mission',
      description: 'MissionSpec 校验并落盘（Codex Desktop 确认方案的正式入口）',
      inputSchema: {
        type: 'object',
        properties: {
          missionYaml: { type: 'string', description: 'mission YAML 全文' },
        },
        required: ['missionYaml'],
      },
      handler: async (args) => {
        const yaml = strOf(args, 'missionYaml');
        const validation = validateMissionContent(yaml, '<mcp>');
        if (!validation.ok || validation.mission === undefined) {
          return toolError(
            'mission_invalid',
            'mission 校验失败（零副作用）',
            validation.issues
              .map((issue) => `[${issue.path}] ${issue.message}`)
              .join('; '),
          );
        }
        mkdirSync(missionsDir, { recursive: true });
        const file = path.join(missionsDir, `${validation.mission.id}.yaml`);
        // 幂等语义：同名覆盖（最新确认的方案生效）
        const { writeFileSync } = await import('node:fs');
        writeFileSync(file, yaml);
        return okText(
          JSON.stringify(
            { missionId: validation.mission.id, path: file },
            null,
            2,
          ),
          { missionId: validation.mission.id, path: file },
        );
      },
    },
    {
      name: 'fleet_run',
      description:
        '执行 mission 全链（隔离 worktree / 验证门 / 预算 / 落盘），同步返回终态概要',
      inputSchema: {
        type: 'object',
        properties: {
          missionPath: { type: 'string', description: 'mission 文件路径' },
        },
        required: ['missionPath'],
      },
      handler: async (args) => {
        const missionPath = strOf(args, 'missionPath');
        if (!existsSync(missionPath)) {
          return toolError('not_found', `mission 不存在：${missionPath}`);
        }
        // 落盘接缝与 CLI 同构（M11 RunStore/EventSink）
        const runDirHolder: { dir?: string } = {};
        const relayBuffer: Array<{
          type: string;
          payload?: Record<string, unknown>;
        }> = [];
        let sinkEmit:
          | ((event: {
              type: string;
              payload?: Record<string, unknown>;
            }) => void)
          | undefined;
        const outcome = await runMissionFile(missionPath, {
          cwd: repoRoot,
          emitEvent: (event) => {
            const plain = {
              type: event.type,
              payload: Object.fromEntries(
                Object.entries(event as Record<string, unknown>).filter(
                  ([key]) => key !== 'type',
                ),
              ) as Record<string, unknown>,
            };
            if (sinkEmit !== undefined) {
              sinkEmit(plain);
            } else {
              relayBuffer.push(plain);
            }
          },
          runPersistence: {
            begin(m, runId) {
              const runShort = runId.slice(4, 15);
              const { dir, eventsPath } = store.beginRun(m, runShort);
              const sink = new EventSink(eventsPath);
              sinkEmit = (event) => sink.emit(event);
              for (const buffered of relayBuffer.splice(0)) {
                sinkEmit(buffered);
              }
              runDirHolder.dir = dir;
              return dir;
            },
            isCancelRequested: (dir) => store.isCancelRequested(dir),
            finalize: (dir, report) => {
              store.finalize(dir, {
                summary: {
                  status: report.outcome.status,
                  startedAt: report.run.startedAt ?? '',
                  endedAt: report.run.endedAt ?? '',
                  tasks: report.outcome.nodes.map((node) => ({
                    taskId: node.taskId,
                    status: node.status,
                    attempts: node.attempts,
                  })),
                  ...(report.reviews !== undefined
                    ? { reviews: report.reviews }
                    : {}),
                  ...(report.budget !== undefined
                    ? { budget: report.budget }
                    : {}),
                  cumulativeAttempts: Object.fromEntries(
                    report.outcome.nodes.map((node) => [
                      node.taskId,
                      node.attempts,
                    ]),
                  ),
                },
                usage: report.budget,
                validation: report.reviews,
              });
              for (const entry of report.workspaces ?? []) {
                if (entry.action === 'merged' && entry.patch !== undefined) {
                  store.writeDiff(dir, entry.taskId, entry.patch);
                }
              }
            },
          },
        });
        if (outcome.kind === 'invalid') {
          return toolError(
            'mission_invalid',
            'mission 校验失败',
            outcome.validation.issues
              .map((issue) => `[${issue.path}] ${issue.message}`)
              .join('; '),
          );
        }
        const report = outcome.report;
        return okText(
          JSON.stringify(
            {
              runId: report.run.id,
              status: report.outcome.status,
              tasks: report.run.taskRuns,
              ...(report.reviews !== undefined
                ? {
                    reviews: (
                      report.reviews as Array<{
                        taskId: string;
                        terminal: string;
                        rounds: number;
                      }>
                    ).map((entry) => ({
                      taskId: entry.taskId,
                      terminal: entry.terminal,
                      rounds: entry.rounds,
                    })),
                  }
                : {}),
              runDir: runDirHolder.dir,
            },
            null,
            2,
          ).slice(0, 30_000),
          { runId: report.run.id, status: report.outcome.status },
        );
      },
    },
    {
      name: 'fleet_status',
      description:
        '任务级状态分布（M11 视图：completed/failed/skipped/interrupted/pending）',
      inputSchema: {
        type: 'object',
        properties: { missionId: { type: 'string' } },
        required: ['missionId'],
      },
      handler: async (args) => {
        const dir = latestRunDir(repoRoot, strOf(args, 'missionId'));
        if (dir === undefined) {
          return toolError(
            'not_found',
            `未知 mission：${strOf(args, 'missionId')}`,
          );
        }
        const view = viewRun(dir);
        if (view === undefined) {
          return toolError('not_started', `run 从未开始：${dir}`);
        }
        return okText(JSON.stringify(view, null, 2), view);
      },
    },
    {
      name: 'fleet_result',
      description:
        'Review Package 聚合（审阅终态+全轮次 / 预算 / diff / 验证证据——Final Review 输入）',
      inputSchema: {
        type: 'object',
        properties: { missionId: { type: 'string' } },
        required: ['missionId'],
      },
      handler: async (args) => {
        const dir = latestRunDir(repoRoot, strOf(args, 'missionId'));
        if (dir === undefined) {
          return toolError(
            'not_found',
            `未知 mission：${strOf(args, 'missionId')}`,
          );
        }
        const summary = readSummaryFile(dir);
        const view = viewRun(dir);
        const partial = summary === undefined; // 进行中（无终局）——不伪造
        const load = (file: string): unknown => {
          try {
            return JSON.parse(
              readFileSync(path.join(dir, file), 'utf8'),
            ) as unknown;
          } catch {
            return undefined;
          }
        };
        const diffExcerpt = (() => {
          try {
            const text = readFileSync(path.join(dir, 'diff.patch'), 'utf8');
            return text.length > 4000
              ? `${text.slice(0, 4000)}\n[…diff 已截断…]`
              : text;
          } catch {
            return undefined;
          }
        })();
        return okText(
          JSON.stringify(
            {
              runDir: dir,
              status: view?.status ?? 'unknown',
              partial,
              tasks: summary?.tasks ?? view?.tasks ?? [],
              reviews: load('validation.json'),
              budget: load('usage.json'),
              diffExcerpt,
            },
            null,
            2,
          ).slice(0, 60_000),
          { runDir: dir, status: view?.status ?? 'unknown', partial },
        );
      },
    },
    {
      name: 'fleet_cancel',
      description: '对活跃 run 发出取消（M11 标记通道；已终态幂等提示）',
      inputSchema: {
        type: 'object',
        properties: { missionId: { type: 'string' } },
        required: ['missionId'],
      },
      handler: async (args) => {
        const missionId = strOf(args, 'missionId');
        const dir = latestRunDir(repoRoot, missionId);
        if (dir === undefined) {
          return toolError('not_found', `未知 mission：${missionId}`);
        }
        const view = viewRun(dir);
        if (view !== undefined && view.status !== 'interrupted') {
          return okText(`run 已终态（${view.status}）——cancel 幂等无操作`, {
            status: view.status,
            cancelled: false,
          });
        }
        store.requestCancel(dir);
        return okText(`取消请求已写入：${dir}`, {
          cancelled: true,
          runDir: dir,
        });
      },
    },
  ];
}

function okText(text: string, payload?: unknown): ToolResult {
  return {
    ok: true,
    content: [{ type: 'text', text }],
    ...(payload !== undefined ? { payload } : {}),
  };
}

function toolError(code: string, message: string, hint?: string): ToolResult {
  return { ok: false, code, message, ...(hint !== undefined ? { hint } : {}) };
}
