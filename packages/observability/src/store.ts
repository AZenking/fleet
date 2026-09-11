import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Mission } from '@fleet/mission';

/**
 * RunStore（research.md D1）：`.fleet/runs/<mission-id>/<runShort>/`
 * 目录生命周期——run 开始写 mission.json（快照 + 指纹），事件经
 * EventSink 流式追加，终局写 summary/usage/diff/validation 四面。
 * 同 mission 多次 run 以 runShort 子目录隔离，互不覆盖。
 */

export const RUNS_DIR = '.fleet/runs';
export const CANCEL_MARKER = 'cancel-requested';

export interface MissionSnapshot {
  mission: Mission;
  fingerprint: string;
  savedAt: string;
}

export interface RunSummary {
  status: 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  endedAt: string;
  tasks: Array<{ taskId: string; status: string; attempts: number }>;
  reviews?: unknown;
  budget?: unknown;
  /** 跨 resume 的累计执行次数（本期 run + 源 run） */
  cumulativeAttempts: Record<string, number>;
}

export interface FinalizeInput {
  summary: RunSummary;
  usage?: unknown;
  /** 每任务的 diff（门通过 = 最终变更面；失败 = 销毁前尽力） */
  diffs?: Array<{ taskId: string; patch: string }>;
  validation?: unknown;
}

export class RunStore {
  constructor(private readonly repoRoot: string) {}

  get baseDir(): string {
    return path.join(this.repoRoot, RUNS_DIR);
  }

  runDirOf(missionId: string, runShort: string): string {
    return path.join(this.baseDir, missionId, runShort);
  }

  /** 开局：幂等建目录 + mission.json + 占位；返回 events sink 路径 */
  beginRun(
    mission: Mission,
    runShort: string,
  ): {
    dir: string;
    eventsPath: string;
  } {
    const dir = this.runDirOf(mission.id, runShort);
    mkdirSync(path.join(dir, 'artifacts'), { recursive: true });
    mkdirSync(path.join(dir, 'logs'), { recursive: true });
    const snapshot: MissionSnapshot = {
      mission,
      fingerprint: fingerprintOf(mission),
      savedAt: new Date().toISOString(),
    };
    writeFileSync(
      path.join(dir, 'mission.json'),
      JSON.stringify(snapshot, null, 2),
    );
    const eventsPath = path.join(dir, 'events.jsonl');
    if (!existsSync(eventsPath)) {
      writeFileSync(eventsPath, '');
    }
    return { dir, eventsPath };
  }

  finalize(runDir: string, input: FinalizeInput): void {
    writeFileSync(
      path.join(runDir, 'summary.json'),
      JSON.stringify(input.summary, null, 2),
    );
    if (input.usage !== undefined) {
      writeFileSync(
        path.join(runDir, 'usage.json'),
        JSON.stringify(input.usage, null, 2),
      );
    }
    if (input.diffs !== undefined && input.diffs.length > 0) {
      const merged = input.diffs
        .map((entry) => `# task ${entry.taskId}\n${entry.patch}`)
        .join('\n\n');
      writeFileSync(path.join(runDir, 'diff.patch'), merged);
    }
    if (input.validation !== undefined) {
      writeFileSync(
        path.join(runDir, 'validation.json'),
        JSON.stringify(input.validation, null, 2),
      );
    }
  }

  writeDiff(runDir: string, taskId: string, patch: string): void {
    const file = path.join(runDir, 'diff.patch');
    const existing = existsSync(file)
      ? `${readFileSync(file, 'utf8')}\n\n`
      : '';
    writeFileSync(file, `${existing}# task ${taskId}\n${patch}`);
  }

  readSnapshot(runDir: string): MissionSnapshot | undefined {
    const file = path.join(runDir, 'mission.json');
    if (!existsSync(file)) {
      return undefined;
    }
    return JSON.parse(readFileSync(file, 'utf8')) as MissionSnapshot;
  }

  readSummary(runDir: string): RunSummary | undefined {
    const file = path.join(runDir, 'summary.json');
    if (!existsSync(file)) {
      return undefined;
    }
    return JSON.parse(readFileSync(file, 'utf8')) as RunSummary;
  }

  /** cancel 通道：标记文件存在即请求（D3） */
  requestCancel(runDir: string): void {
    writeFileSync(
      path.join(runDir, CANCEL_MARKER),
      `${new Date().toISOString()}\n`,
    );
  }

  isCancelRequested(runDir: string): boolean {
    return existsSync(path.join(runDir, CANCEL_MARKER));
  }
}

/** 任务集指纹（djb2——变更检测用途，非加密） */
export function fingerprintOf(mission: Mission): string {
  const tasks = (mission.tasks ?? [])
    .map((task) => `${task.id}:${task.agentRole}:${task.dependsOn.join('+')}`)
    .sort()
    .join('|');
  const raw = `${mission.id}#${tasks}`;
  let hash = 5381;
  for (let index = 0; index < raw.length; index += 1) {
    hash = ((hash << 5) + hash + raw.charCodeAt(index)) | 0;
  }
  return `fp_${(hash >>> 0).toString(16)}`;
}
