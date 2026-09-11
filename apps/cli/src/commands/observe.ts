import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';

import { stderrLogger } from '@fleet/core';
import {
  EventSink,
  RunStore,
  cleanupOrphans,
  isCancelRequested,
  latestRunDir,
  listRuns,
  readEvents,
  readSummaryFile,
  scanOrphans,
  viewRun,
} from '@fleet/observability';

/**
 * M11 观测命令组（contracts/observability-api.md §7）：
 * ps / status / logs / inspect / diff / cancel / clean——全部只读
 * `.fleet/runs/`（cancel 写标记、clean 执行清理）。
 */

export function registerObserveCommands(program: Command): void {
  program
    .command('ps')
    .description('列出全部 run（mission / 状态 / 任务进度 / 时间）')
    .option('--orphans', '附加孤儿资源报告（worktree / 进程）')
    .action(async (options: { orphans?: boolean }) => {
      const runs = listRuns(process.cwd());
      if (runs.length === 0) {
        console.log('（暂无 run——.fleet/runs/ 为空）');
      }
      for (const run of runs) {
        const progress = `${run.counts.completed}✓ ${run.counts.failed}✗ ${run.counts.skipped}↷ ${run.counts.interrupted}⏸ ${run.counts.pending}…`;
        console.log(
          `${run.missionId.padEnd(20)} ${run.runShort.padEnd(16)} ${run.status.padEnd(12)} ${progress.padEnd(24)} ${run.startedAt ?? ''}`,
        );
      }
      if (options.orphans === true) {
        const report = await scanOrphans(process.cwd());
        console.log(
          `孤儿：worktree ${report.worktrees.length} 个 · 进程 ${report.processes.length} 个（fleet clean --force 清理）`,
        );
        for (const entry of report.worktrees) {
          console.log(`  worktree ${entry.path}`);
        }
        for (const proc of report.processes) {
          console.log(`  process ${proc.pid}  ${proc.command.slice(0, 80)}`);
        }
      }
    });

  program
    .command('status <mission>')
    .description('任务级状态分布 + 终局摘要（最新 run）')
    .action((missionId: string) => {
      const dir = latestRunDir(process.cwd(), missionId);
      if (dir === undefined) {
        console.error(`✗ 未知 mission：${missionId}（.fleet/runs/ 无记录）`);
        process.exitCode = 1;
        return;
      }
      const view = viewRun(dir);
      if (view === undefined) {
        console.error(`✗ run 从未开始：${dir}`);
        process.exitCode = 1;
        return;
      }
      console.log(
        `▶ ${view.missionId} · ${view.status} · ${view.startedAt ?? ''}`,
      );
      for (const task of view.tasks) {
        console.log(`    ${task.taskId.padEnd(20)} ${task.status}`);
      }
      const summary = readSummaryFile(dir);
      if (summary !== undefined) {
        console.log(
          `  摘要：${summary.status} · 任务 ${summary.tasks.length} · 累计执行 ${Object.values(summary.cumulativeAttempts).reduce((a, b) => a + b, 0)} 次`,
        );
      }
    });

  program
    .command('logs <mission>')
    .description('事件时间线（--type 前缀过滤，如 --type task.）')
    .option('--type <prefix>', '事件类型前缀过滤')
    .action((missionId: string, options: { type?: string }) => {
      const dir = latestRunDir(process.cwd(), missionId);
      if (dir === undefined) {
        console.error(`✗ 未知 mission：${missionId}`);
        process.exitCode = 1;
        return;
      }
      const { events, skippedLines } = readEvents(
        path.join(dir, 'events.jsonl'),
      );
      if (skippedLines > 0) {
        stderrLogger.warn(`已跳过 ${skippedLines} 行损坏事件（半行容错）`);
      }
      for (const event of events) {
        if (
          options.type !== undefined &&
          !event.type.startsWith(options.type)
        ) {
          continue;
        }
        const brief = JSON.stringify(event.payload).slice(0, 100);
        console.log(`${event.timestamp} ${event.type.padEnd(28)} ${brief}`);
      }
    });

  program
    .command('inspect <mission>')
    .description('完整 RunReport / summary JSON')
    .action((missionId: string) => {
      const dir = latestRunDir(process.cwd(), missionId);
      if (dir === undefined) {
        console.error(`✗ 未知 mission：${missionId}`);
        process.exitCode = 1;
        return;
      }
      const summary = readSummaryFile(dir);
      const snapshot = readFileSync(path.join(dir, 'mission.json'), 'utf8');
      console.log(
        JSON.stringify({ mission: JSON.parse(snapshot), summary }, null, 2),
      );
    });

  program
    .command('diff <mission>')
    .description('输出 diff.patch（变更面）')
    .action((missionId: string) => {
      const dir = latestRunDir(process.cwd(), missionId);
      if (dir === undefined) {
        console.error(`✗ 未知 mission：${missionId}`);
        process.exitCode = 1;
        return;
      }
      const file = path.join(dir, 'diff.patch');
      try {
        console.log(readFileSync(file, 'utf8'));
      } catch {
        console.error(`✗ 无 diff.patch（该 run 无通过验证门的写任务）`);
        process.exitCode = 2;
      }
    });

  program
    .command('cancel <mission>')
    .description('对活跃 run 发出取消（标记文件 → 批次屏障检查点）')
    .action((missionId: string) => {
      const dir = latestRunDir(process.cwd(), missionId);
      if (dir === undefined) {
        console.error(`✗ 未知 mission：${missionId}`);
        process.exitCode = 1;
        return;
      }
      const view = viewRun(dir);
      if (view !== undefined && view.status !== 'interrupted') {
        console.log(`ℹ run 已终态（${view.status}）——cancel 幂等无操作`);
        return;
      }
      const store = new RunStore(process.cwd());
      store.requestCancel(dir);
      console.log(`✓ 取消请求已写入：${dir}`);
    });

  program
    .command('clean')
    .description('孤儿资源清理（缺省 dry-run；--force 执行）')
    .option('--force', '执行清理（SIGTERM 孤儿进程 + worktree 最小清理）')
    .action(async (options: { force?: boolean }) => {
      const report = await scanOrphans(process.cwd());
      if (report.worktrees.length === 0 && report.processes.length === 0) {
        console.log('✓ 无孤儿资源');
        return;
      }
      if (options.force !== true) {
        console.log('dry-run（--force 执行）：');
        for (const entry of report.worktrees) {
          console.log(`  worktree ${entry.path}`);
        }
        for (const proc of report.processes) {
          console.log(`  process ${proc.pid}  ${proc.command.slice(0, 80)}`);
        }
        return;
      }
      const result = await cleanupOrphans(process.cwd(), report, {
        force: true,
      });
      for (const item of result.cleaned) {
        console.log(`✓ 已清理 ${item}`);
      }
    });
}

export { EventSink, RunStore, isCancelRequested, viewRun };
