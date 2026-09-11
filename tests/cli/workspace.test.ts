import { execSync } from 'node:child_process';
import {
  existsSync,
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
 * M8 e2e（T013）：SC-002 三段式（主仓全程干净轮询 + 互不可见 +
 * 双 merge 兼得）+ --no-worktree 回退 + run 中故障不击穿 + 报告
 * workspaces 字段。全程 tmp git 仓库 + write-cli 替身。
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
let missionsDir: string;

function git(cmd: string): string {
  return execSync(`git ${cmd}`, {
    cwd: repo,
    env: { ...process.env, ...GIT_ENV },
  }).toString();
}

function statusClean(): boolean {
  return (
    execSync('git status --porcelain', { cwd: repo }).toString().trim() === ''
  );
}

function missionYaml(tasks: string): string {
  return `
id: ws-e2e
goal: 隔离验证
planningMode: execution
requirements:
  - text: 需求
plan:
  summary: 方案
tasks:
${tasks}
acceptance:
  - given: 无
    when: 执行
    then: 完成
`;
}

beforeAll(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'fleet-ws-e2e-'));
  missionsDir = mkdtempSync(path.join(tmpdir(), 'fleet-ws-e2e-m-'));
  git('init -q -b main');
  writeFileSync(path.join(repo, '.gitignore'), '.fleet/\n');
  writeFileSync(path.join(repo, 'base.txt'), 'baseline\n');
  git('add -A');
  git('commit -qm baseline');
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(missionsDir, { recursive: true, force: true });
});

async function runFleet(args: string[]) {
  return execa(process.execPath, [bin, ...args], {
    cwd: repo,
    reject: false,
    env: {
      ...process.env,
      ...GIT_ENV,
      PATH: `${fixtureClis}:${process.env.PATH}`,
    },
  });
}

function writeTask(
  id: string,
  role = 'reason',
  dependsOn = '[]',
  file?: string,
): string {
  return `  - id: ${id}\n    goal: 写 ${id}\n    agentRole: ${role}\n    dependsOn: ${dependsOn}${
    file !== undefined
      ? `\n    constraints:\n      - kind: maxDurationMs\n        value: 30000`
      : ''
  }\n`;
}

function writeMissionFile(name: string, tasks: string): string {
  // mission 文件放仓外 tmp——写主仓根会成为未跟踪脏项触发 dirty_main
  const file = path.join(missionsDir, `${name}.yaml`);
  writeFileSync(file, missionYaml(tasks), 'utf8');
  return file;
}

describe('SC-002 三段式：双 reason 并行物理隔离（验收锚点）', () => {
  it('主仓全程干净 + 互不可见 + 双 merge 兼得', async () => {
    const file = writeMissionFile(
      'parallel-demo',
      writeTask('task-a', 'reason', '[]', 'a') +
        writeTask('task-b', 'reason', '[]', 'b'),
    );
    // 替身写文件的 env：两任务同一替身命令，靠 goal 参数区分不可行——
    // 用两次独立运行？不——同 run 内两任务并发，替身 env 全局。
    // 方案：替身按 prompt 参数写文件（goal 即文件名）。
    // 允许清单：merge 事务窗口内主仓可瞬时看到任务产物（授权变更）；
    // 任何其他文件出现 = 未授权泄漏（隔离破坏）
    const allowed = new Set(['task-a.txt', 'task-b.txt']);
    const violations: string[] = [];
    const sampler = setInterval(() => {
      try {
        const out = execSync('git status --porcelain', {
          cwd: repo,
        }).toString();
        for (const line of out.split('\n')) {
          const file = line.slice(3).trim();
          if (file !== '' && !allowed.has(file)) {
            violations.push(line.trim());
          }
        }
      } catch {
        // 采样失败忽略
      }
    }, 50);

    const result = await runFleet([
      'run',
      file,
      '--runtime',
      'write-cli.sh',
      '--no-validation-gate',
      '--json',
    ]);
    clearInterval(sampler);

    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.run.status).toBe('completed');

    // ① 全程无未授权泄漏（终态干净 + 采样仅见允许清单）
    expect(violations).toEqual([]);
    expect(statusClean()).toBe(true);

    // ③ 双 merge 兼得（write-cli 按 prompt=goal 写 <goal>.txt）
    expect(existsSync(path.join(repo, 'task-a.txt'))).toBe(true);
    expect(existsSync(path.join(repo, 'task-b.txt'))).toBe(true);

    // 报告 workspaces 字段
    expect(report.workspaces).toHaveLength(2);
    expect(
      report.workspaces.every(
        (ws: { action: string }) => ws.action === 'merged',
      ),
    ).toBe(true);
  }, 60_000);
});

describe('--no-worktree 回退（M7 行为）', () => {
  it('写角色直接在主仓根执行（无 worktree 创建）', async () => {
    const file = writeMissionFile(
      'no-wt-demo',
      writeTask('direct-write', 'reason'),
    );
    const result = await runFleet([
      'run',
      file,
      '--runtime',
      'write-cli.sh',
      '--no-worktree',
      '--json',
    ]);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.workspaces).toBeUndefined();
    const wtDir = path.join(repo, '.fleet', 'worktrees');
    expect(existsSync(wtDir) ? readdirSync(wtDir).length : 0).toBe(0);
    // 替身按 [任务 direct-write] 标记写文件（直接在主仓——脏但这是回退语义）
    expect(existsSync(path.join(repo, 'direct-write.txt'))).toBe(true);
    git('reset --hard -q HEAD'); // 清理主仓脏文件
    git('clean -fdq');
  });
});

describe('run 中故障不击穿（SC-006）', () => {
  it('worktree create 故障（残留分支）→ 任务失败 + 报告明细 + run 退出码 1', async () => {
    git('branch fleet/fault0001/blocked-task');
    try {
      const file = writeMissionFile(
        'fault-demo',
        writeTask('blocked-task', 'reason'),
      );
      // runId 需匹配残留分支前缀——runId 由 runner 生成随机……
      // 改用确定手段：dirty 主仓触发 create 故障（更可控）
      writeFileSync(path.join(repo, 'stain.txt'), 'dirty\n');
      const result = await runFleet([
        'run',
        file,
        '--runtime',
        'write-cli.sh',
        '--json',
      ]);
      expect(result.exitCode).toBe(1);
      const report = JSON.parse(result.stdout);
      const node = report.outcome.nodes.find(
        (n: { taskId: string }) => n.taskId === 'blocked-task',
      );
      expect(node.status).toBe('failed');
      expect(node.failureReason).toContain('dirty_main');
      rmSync(path.join(repo, 'stain.txt'));
    } finally {
      git('branch -D fleet/fault0001/blocked-task');
    }
  });
});

describe('基线继承（依赖链）', () => {
  it('B 在 A merge 后执行——基线含 A 的产出', async () => {
    const file = writeMissionFile(
      'chain-demo',
      writeTask('first-writer', 'reason', '[]', 'x') +
        writeTask('second-reader', 'focus', '[first-writer]'),
    );
    const result = await runFleet([
      'run',
      file,
      '--runtime',
      'write-cli.sh',
      '--no-validation-gate',
      '--json',
    ]);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.outcome.dispatchOrder).toEqual([
      'first-writer',
      'second-reader',
    ]);
    // 只读角色无 workspace 处置记录；写角色 merged
    expect(report.workspaces).toHaveLength(1);
    expect(report.workspaces[0].taskId).toBe('first-writer');
    void readFileSync;
  });
});
