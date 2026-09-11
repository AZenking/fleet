import { execSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * M11 e2e：验收锚点——进程异常退出后不丢失 Run 状态，能识别已完成
 * 任务、清理孤儿资源并从合理位置 Resume。SC-001..007。
 */

const bin = new URL('../../apps/cli/dist/bin.js', import.meta.url).pathname;
const fixtureClis = new URL('../fixtures/fake-clis/', import.meta.url).pathname;

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'fleet-test',
  GIT_AUTHOR_EMAIL: 'test@fleet.local',
  GIT_COMMITTER_NAME: 'fleet-test',
  GIT_COMMITTER_EMAIL: 'test@fleet.local',
};

let repo: string;

function git(cmd: string): string {
  return execSync(`git ${cmd}`, {
    cwd: repo,
    env: { ...process.env, ...GIT_ENV },
  }).toString();
}

function missionYaml(id: string, tasksYaml: string, validation = ''): string {
  return `
id: ${id}
goal: ${id}
planningMode: execution
requirements:
  - text: 需求
plan:
  summary: 方案
tasks:
${tasksYaml}
${validation}acceptance:
  - given: 无
    when: 执行
    then: 完成
`;
}

const QUICK_SLOW = missionYaml(
  'r11-seq',
  `  - id: quick
    goal: quick
    agentRole: reflex
    dependsOn: []
  - id: slow
    goal: slow
    agentRole: reason
    dependsOn: [quick]`,
  'validation:\n  commands:\n    tests: echo ok\n',
);

const CANCEL_MISSION = missionYaml(
  'r11-cancel',
  `  - id: hangtask
    goal: hangtask
    agentRole: reason
    dependsOn: []
  - id: dependent
    goal: dependent
    agentRole: focus
    dependsOn: [hangtask]`,
);

function baseEnv(): Record<string, string> {
  return {
    ...process.env,
    ...GIT_ENV,
    PATH: `${fixtureClis}:${process.env.PATH}`,
  };
}

async function fleet(args: string[]) {
  const result = await execa(process.execPath, [bin, ...args], {
    cwd: repo,
    reject: false,
    env: baseEnv(),
    timeout: 25_000,
    killSignal: 'SIGKILL',
  });
  return {
    exitCode: result.exitCode ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function runDirs(missionId: string): string[] {
  const base = path.join(repo, '.fleet/runs', missionId);
  return existsSync(base) ? readdirSync(base) : [];
}

function viewRunStatus(runDir: string): string | undefined {
  // 纯事件流判态（与 @fleet/observability viewRun 同语义，测试本地实现）
  const { events } = readEventsLocal(path.join(runDir, 'events.jsonl'));
  if (!events.some((event) => event.type === 'mission.started')) {
    return undefined;
  }
  const terminal = events.findLast((event) =>
    ['mission.completed', 'mission.failed', 'mission.cancelled'].includes(
      event.type,
    ),
  );
  return terminal !== undefined
    ? terminal.type.replace('mission.', '')
    : 'interrupted';
}

function readEventsLocal(eventsPath: string): {
  events: Array<{ type: string }>;
} {
  try {
    const lines = readFileSync(eventsPath, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0);
    return {
      events: lines.map((line) => JSON.parse(line) as { type: string }),
    };
  } catch {
    return { events: [] };
  }
}

function eventsOf(missionId: string, runShort: string): string[] {
  const file = path.join(
    repo,
    '.fleet/runs',
    missionId,
    runShort,
    'events.jsonl',
  );
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map(
      (line) =>
        JSON.parse(line) as { type: string; payload?: Record<string, unknown> },
    );
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return predicate();
}

beforeAll(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'fleet-r11-e2e-'));
  git('init -q -b main');
  writeFileSync(path.join(repo, '.gitignore'), '.fleet/\n');
  writeFileSync(path.join(repo, 'base.txt'), 'baseline\n');
  writeFileSync(path.join(repo, 'seq.yaml'), QUICK_SLOW);
  writeFileSync(path.join(repo, 'cancel.yaml'), CANCEL_MISSION);
  git('add -A');
  git('commit -qm baseline');
});

afterAll(() => {
  if (process.env.KEEP_REPO === '1') {
    console.error('[keep] repo kept at:', repo);
    return;
  }
  rmSync(repo, { recursive: true, force: true });
});

describe('M11 e2e：持久化 / 中断 / Resume / Cancel / 孤儿', () => {
  it('SC-001 正常 run：八件套落盘 + summary 与报告一致 + 事件全集', async () => {
    const run = await fleet([
      'run',
      'seq.yaml',
      '--runtime',
      'reason=write-cli.sh',
      '--runtime',
      'wisdom=review-approved-cli.sh',
      '--json',
    ]);
    expect(run.exitCode).toBe(0);
    const dirs = runDirs('r11-seq');
    expect(dirs).toHaveLength(1);
    const dir = path.join(repo, '.fleet/runs/r11-seq', dirs[0]!);
    for (const file of [
      'mission.json',
      'events.jsonl',
      'summary.json',
      'usage.json',
      'diff.patch',
      'validation.json',
      'artifacts',
      'logs',
    ]) {
      expect(existsSync(path.join(dir, file))).toBe(true);
    }
    const report = JSON.parse(run.stdout) as { budget?: unknown };
    const summary = JSON.parse(
      readFileSync(path.join(dir, 'summary.json'), 'utf8'),
    ) as { status: string; tasks: Array<{ status: string }> };
    expect(summary.status).toBe('completed');
    expect(summary.tasks.every((task) => task.status === 'completed')).toBe(
      true,
    );
    const usage = JSON.parse(
      readFileSync(path.join(dir, 'usage.json'), 'utf8'),
    );
    expect(usage).toEqual(report.budget);

    // SC-005 事件全集（本 run 路径覆盖的部分）
    const types = eventsOf('r11-seq', dirs[0]!).map((event) => event.type);
    for (const expected of [
      'mission.created',
      'mission.started',
      'mission.completed',
      'task.queued',
      'task.started',
      'task.completed',
      'workspace.created',
      'workspace.destroyed',
      'validation.started',
      'validation.completed',
      'review.requested',
      'review.approved',
      'budget.warning', // 无预算不压缩——不应出现
    ]) {
      if (expected === 'budget.warning') {
        expect(types).not.toContain(expected);
      } else {
        expect(types).toContain(expected);
      }
    }
  });

  it('SC-002 kill -9 中断：ps 识别 interrupted + status 分布 + events 行级合法', async () => {
    const child = execa(
      process.execPath,
      [
        bin,
        'run',
        'seq.yaml',
        '--runtime',
        'reflex=write-cli.sh',
        '--runtime',
        'reason=hang-cli.sh',
        '--runtime',
        'wisdom=review-approved-cli.sh',
      ],
      { cwd: repo, reject: false, env: baseEnv() },
    );
    // quick 先完成（write? 不——hang-cli 处理两个任务都 hang？）
    // quick 与 slow 都走 reason=hang-cli：quick 也 hang → 无 completed。
    // 改用 mixed：quick=write-cli slow=hang → role 同 runtime……
    // 直接等 mission.started + task.started 落盘后 kill。
    const dirCountBefore = runDirs('r11-seq').length;
    const started = await waitFor(() => {
      const dirs = runDirs('r11-seq');
      if (dirs.length <= dirCountBefore) {
        return false;
      }
      try {
        const events = eventsOf('r11-seq', dirs.at(-1)!);
        // quick（reflex + write-cli）完成 + slow（hang）已开始——杀在 slow 进行中
        return (
          events.some(
            (event) =>
              event.type === 'task.completed' &&
              event.payload?.taskId === 'quick',
          ) &&
          events.some(
            (event) =>
              event.type === 'task.started' && event.payload?.taskId === 'slow',
          )
        );
      } catch {
        return false;
      }
    }, 20_000);
    expect(started).toBe(true);
    process.kill(child.pid!, 'SIGKILL');
    await child.catch(() => undefined);

    const ps = await fleet(['ps']);
    expect(ps.exitCode).toBe(0);
    expect(ps.stdout).toContain('interrupted');

    const status = await fleet(['status', 'r11-seq']);
    expect(status.exitCode).toBe(0);
    expect(status.stdout).toContain('quick');
    // 事件行级合法（eventsOf JSON.parse 全行成功即证明）
    const latest = runDirs('r11-seq').at(-1)!;
    expect(eventsOf('r11-seq', latest).length).toBeGreaterThan(0);
  });

  it('SC-003 resume：已完成任务零重跑 + mission completed + 累计执行', async () => {
    // 确定性构造 interrupted 状态（kill 编排的真实性由 SC-002 承载；
    // 本用例专注 resume 机制：完成集裁剪 + 零重跑 + 续写语义）。
    // 落盘格式与 @fleet/observability 一致（指纹算法在此钉死）。
    const runShort = 'synth0001';
    const dir = path.join(repo, '.fleet/runs/r11-seq', runShort);
    mkdirSync(path.join(dir, 'artifacts'), { recursive: true });
    mkdirSync(path.join(dir, 'logs'), { recursive: true });
    const taskSpecs = [
      { id: 'quick', agentRole: 'reflex', dependsOn: [] },
      { id: 'slow', agentRole: 'reason', dependsOn: ['quick'] },
    ];
    let hash = 5381;
    const raw = `r11-seq#${taskSpecs
      .map((t) => `${t.id}:${t.agentRole}:${t.dependsOn.join('+')}`)
      .sort()
      .join('|')}`;
    for (let i = 0; i < raw.length; i += 1) {
      hash = ((hash << 5) + hash + raw.charCodeAt(i)) | 0;
    }
    writeFileSync(
      path.join(dir, 'mission.json'),
      JSON.stringify({
        mission: { id: 'r11-seq', tasks: taskSpecs },
        fingerprint: `fp_${(hash >>> 0).toString(16)}`,
        savedAt: new Date().toISOString(),
      }),
    );
    const synthEvents = [
      'mission.created',
      'mission.started',
      'task.queued:quick',
      'task.queued:slow',
      'task.started:quick',
      'task.completed:quick',
      'task.started:slow',
    ].map((entry) => {
      const [type, taskId] = entry.split(':');
      return JSON.stringify({
        id: `evt_synth-${Math.random().toString(36).slice(2, 10)}`,
        type,
        timestamp: new Date().toISOString(),
        payload: taskId !== undefined ? { taskId } : { missionId: 'r11-seq' },
      });
    });
    writeFileSync(
      path.join(dir, 'events.jsonl'),
      `${synthEvents.join('\n')}\n`,
    );
    // —— interrupted：无 mission 终态 ——
    expect(viewRunStatus(dir)).toBe('interrupted');

    const resume = await fleet([
      'run',
      'seq.yaml',
      '--resume',
      '--runtime',
      'reflex=write-cli.sh',
      '--runtime',
      'reason=write-cli.sh',
      '--runtime',
      'wisdom=review-approved-cli.sh',
      '--json',
    ]);
    expect(resume.exitCode, resume.stdout.slice(0, 300)).toBe(0);
    const report = JSON.parse(resume.stdout) as {
      run: { status: string };
      outcome: { nodes: Array<{ taskId: string; attempts: number }> };
    };
    expect(report.run.status).toBe('completed');
    expect(report.outcome.nodes.map((node) => node.taskId)).toEqual(['slow']); // 仅未完成任务

    // 新 run 目录：quick 以 task.skipped(resume) 标注、零 started
    const resumeDir = runDirs('r11-seq').find(
      (dirEntry) =>
        dirEntry !== runShort &&
        eventsOf('r11-seq', dirEntry).some(
          (event) =>
            event.type === 'task.skipped' &&
            event.payload?.taskId === 'quick' &&
            event.payload?.by === 'resume',
        ),
    );
    expect(resumeDir).toBeDefined();
    const events = eventsOf('r11-seq', resumeDir!);
    expect(
      events.filter(
        (event) =>
          event.type === 'task.started' && event.payload?.taskId === 'quick',
      ),
    ).toHaveLength(0); // 已完成任务零重跑
    expect(
      events.find(
        (event) =>
          event.type === 'task.completed' && event.payload?.taskId === 'slow',
      ),
    ).toBeDefined();
    const summary = JSON.parse(
      readFileSync(
        path.join(repo, '.fleet/runs/r11-seq', resumeDir!, 'summary.json'),
        'utf8',
      ),
    ) as { cumulativeAttempts: Record<string, number> };
    expect(Object.values(summary.cumulativeAttempts).length).toBeGreaterThan(0);
  });

  it('SC-004 cancel：活跃 hang run → cancelled + 未开始任务不开始 + 幂等', async () => {
    const child = execa(
      process.execPath,
      [bin, 'run', 'cancel.yaml', '--runtime', 'reason=hang-cli.sh'],
      { cwd: repo, reject: false, env: baseEnv() },
    );
    const began = await waitFor(() => {
      try {
        return runDirs('r11-cancel').some((dir) =>
          eventsOf('r11-cancel', dir).some(
            (event) => event.type === 'task.started',
          ),
        );
      } catch {
        return false;
      }
    }, 15_000);
    expect(began).toBe(true);

    const cancel = await fleet(['cancel', 'r11-cancel']);
    expect(cancel.exitCode).toBe(0);

    const done = await child.catch((error: unknown) => error);
    void done;
    expect(child.exitCode).not.toBe(0);

    const status = await fleet(['status', 'r11-cancel']);
    expect(status.stdout).toContain('cancelled');
    const events = eventsOf('r11-cancel', runDirs('r11-cancel').at(-1)!);
    expect(
      events.find(
        (event) =>
          event.type === 'task.skipped' &&
          event.payload?.taskId === 'dependent',
      ),
    ).toBeDefined();
    expect(events.some((event) => event.type === 'mission.cancelled')).toBe(
      true,
    );

    // 二次 cancel：幂等提示
    const again = await fleet(['cancel', 'r11-cancel']);
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toContain('幂等');
  }, 30_000);

  it('SC-007 指纹防漂移：任务集变更 → resume 拒绝', async () => {
    writeFileSync(
      path.join(repo, 'drift.yaml'),
      QUICK_SLOW.replace('- id: slow', '- id: slow2'),
    );
    const dirs = runDirs('r11-seq');
    const resume = await fleet([
      'run',
      'drift.yaml',
      '--resume',
      path.join(repo, '.fleet/runs/r11-seq', dirs[0]!),
    ]);
    expect(resume.exitCode).toBe(1);
    expect(resume.stdout).toContain('指纹漂移');
  });

  it('SC-006 孤儿清理：worktree + 进程 → ps --orphans 列出 → clean --force 归零', async () => {
    // 制造孤儿 worktree
    mkdirSync(path.join(repo, '.fleet/worktrees'), { recursive: true });
    execSync(
      `git worktree add -q --detach ${path.join(repo, '.fleet/worktrees/orphan-x')} HEAD`,
      { cwd: repo, env: { ...process.env, ...GIT_ENV } },
    );
    // 制造孤儿进程（FLEET_CHILD 标记）
    const orphanProcess = execa(
      '/bin/bash',
      ['-c', 'export FLEET_CHILD=1; sleep 60'],
      { reject: false, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' },
    );
    await new Promise((resolve) => setTimeout(resolve, 300));

    const ps = await fleet(['ps', '--orphans']);
    expect(ps.exitCode).toBe(0);
    expect(ps.stdout).toContain('orphan-x');
    expect(ps.stdout).toMatch(/process \d+/);

    const clean = await fleet(['clean', '--force']);
    expect(clean.exitCode).toBe(0);
    await orphanProcess.catch(() => undefined);
    expect(orphanProcess.killed || orphanProcess.exitCode !== null).toBe(true);
    expect(existsSync(path.join(repo, '.fleet/worktrees/orphan-x'))).toBe(
      false,
    );

    const after = await fleet(['ps', '--orphans']);
    expect(after.stdout).toContain('孤儿：worktree 0 个 · 进程 0 个');
  }, 30_000);

  it('命令矩阵：未知 mission 非零退出；logs/inspect/diff 可用', async () => {
    for (const command of ['status', 'logs', 'inspect', 'diff', 'cancel']) {
      const result = await fleet([command, 'no-such-mission']);
      expect(result.exitCode, command).toBe(1);
    }
    const logs = await fleet(['logs', 'r11-seq', '--type', 'task.']);
    expect(logs.exitCode).toBe(0);
    expect(logs.stdout).toContain('task.');
    const inspect = await fleet(['inspect', 'r11-seq']);
    expect(inspect.exitCode).toBe(0);
    // 有变更的 mission → diff 输出；无变更的 resume run → 退出 2（无门通过变更面）
    writeFileSync(
      path.join(repo, 'diffdemo.yaml'),
      missionYaml(
        'r11-diff',
        `  - id: writer
    goal: writer
    agentRole: reason
    dependsOn: []`,
        'validation:\n  commands:\n    tests: echo ok\n',
      ),
    );
    git('add -A');
    git('commit -qm diffdemo');
    const demoRun = await fleet([
      'run',
      'diffdemo.yaml',
      '--runtime',
      'reason=write-cli.sh',
      '--runtime',
      'wisdom=review-approved-cli.sh',
    ]);
    expect(demoRun.exitCode, demoRun.stdout).toBe(0);
    const diff = await fleet(['diff', 'r11-diff']);
    expect(diff.exitCode).toBe(0);
    expect(diff.stdout).toContain('diff --git');
    const noDiff = await fleet(['diff', 'r11-seq']);
    expect([0, 2]).toContain(noDiff.exitCode); // 最新 run 若无变更面 → 2（语义合法）
  });
});
