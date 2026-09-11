import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * M9 e2e（T014）：SC-001 自报矛盾（验收锚点）/ SC-003 三路径与
 * 上限强制 / SC-004 零 merge / SC-005 事件重放 / SC-006 三终态
 * ReviewPackage / 逃生口 / timeout 路径。全程 tmp git 仓库 +
 * 替身 CLI（self-report / review-approve / review-reject / checks）。
 */

const bin = new URL('../../apps/cli/dist/bin.js', import.meta.url).pathname;
const fixtureClis = new URL('../fixtures/fake-clis/', import.meta.url).pathname;
const fixtureChecks = new URL('../fixtures/checks/', import.meta.url).pathname;

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'fleet-test',
  GIT_AUTHOR_EMAIL: 'test@fleet.local',
  GIT_COMMITTER_NAME: 'fleet-test',
  GIT_COMMITTER_EMAIL: 'test@fleet.local',
};

let repo: string;
let missionsDir: string;
let flipFile: string;

function git(cmd: string): string {
  return execSync(`git ${cmd}`, {
    cwd: repo,
    env: { ...process.env, ...GIT_ENV },
  }).toString();
}

function missionYaml(
  id: string,
  taskId: string,
  testsCmd: string,
  extra = '',
): string {
  return `
id: ${id}
goal: ${id} 验证门
planningMode: execution
requirements:
  - text: 需求
plan:
  summary: 方案
tasks:
  - id: ${taskId}
    goal: 实现 ${taskId}
    agentRole: reason
validation:
  commands:
    tests: ${testsCmd}
${extra}acceptance:
  - given: 无
    when: 执行
    then: 完成
`;
}

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  json: Record<string, unknown>;
  events: Array<Record<string, unknown>>;
}

function parseEvents(stderr: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  for (const line of stderr.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('{"id":"evt_')) {
      events.push(JSON.parse(trimmed) as Record<string, unknown>);
    }
  }
  return events;
}

async function runFleet(
  missionFile: string,
  runtimes: string[],
  extraArgs: string[] = [],
  env: Record<string, string> = {},
): Promise<RunResult> {
  const result = await execa(
    process.execPath,
    [
      bin,
      'run',
      missionFile,
      ...runtimes.flatMap((spec) => ['--runtime', spec]),
      '--json',
      ...extraArgs,
    ],
    {
      cwd: repo,
      reject: false,
      env: {
        ...process.env,
        ...GIT_ENV,
        PATH: `${missionsDir}:${fixtureClis}:${process.env.PATH}`,
        ...env,
      },
    },
  );
  return {
    exitCode: result.exitCode ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
    json: JSON.parse(result.stdout) as Record<string, unknown>,
    events: parseEvents(result.stderr),
  };
}

function reviewPackageOf(run: RunResult, taskId: string) {
  const reviews = run.json.reviews as Array<Record<string, unknown>>;
  return reviews?.find((entry) => entry.taskId === taskId);
}

function nodeOf(run: RunResult, taskId: string) {
  const outcome = run.json.outcome as {
    nodes: Array<{ taskId: string; attempts: number; failureReason?: string }>;
  };
  return outcome.nodes.find((node) => node.taskId === taskId);
}

beforeAll(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'fleet-v9-e2e-'));
  missionsDir = mkdtempSync(path.join(tmpdir(), 'fleet-v9-e2e-bin-'));
  flipFile = path.join(missionsDir, 'flip.count');

  git('init -q -b main');
  writeFileSync(path.join(repo, '.gitignore'), '.fleet/\n');
  writeFileSync(path.join(repo, 'base.txt'), 'baseline\n');
  // 检查脚本进仓（worktree 内相对路径引用）
  execSync(`cp ${fixtureChecks}*.sh ${repo}/checks-tmp 2>/dev/null || true`);
  execSync(
    `mkdir -p ${repo}/checks && cp ${fixtureChecks}*.sh ${repo}/checks/`,
  );
  git('add -A');
  git('commit -qm baseline');

  // 自报替身：写文件 + stdout 自报"tests passed"（SC-001 矛盾注入载体）
  writeFileSync(
    path.join(missionsDir, 'self-report-cli.sh'),
    [
      '#!/usr/bin/env bash',
      'if [ "$1" = "--version" ]; then echo "self-report 1.0"; exit 0; fi',
      "name=$(printf '%s' \"$*\" | grep -o '\\[任务 [^]]*\\]' | head -1 | sed 's/\\[任务 //;s/\\]//')",
      'printf \'impl by %s\\n\' "${name:-unknown}" > "${name:-unknown}.txt"',
      'echo "tests passed ✓ (self-reported)"',
    ].join('\n'),
    { mode: 0o755 },
  );
  // 乱码审阅替身：输出不可解析为裁决（review_error 路径）
  writeFileSync(
    path.join(missionsDir, 'garbage-review-cli.sh'),
    [
      '#!/usr/bin/env bash',
      'if [ "$1" = "--version" ]; then echo "garbage-review 1.0"; exit 0; fi',
      'echo "看着不错，直接合了吧"',
    ].join('\n'),
    { mode: 0o755 },
  );
  writeFileSync(
    path.join(repo, 'm1.yaml'),
    missionYaml('v9-anchor', 'impl-anchor', './checks/tests-fail.sh'),
  );
  writeFileSync(
    path.join(repo, 'm2.yaml'),
    missionYaml('v9-pass', 'impl-pass', './checks/tests-pass.sh'),
  );
  writeFileSync(
    path.join(repo, 'm3.yaml'),
    missionYaml('v9-flip', 'impl-flip', './checks/tests-pass.sh'),
  );
  writeFileSync(
    path.join(repo, 'm4.yaml'),
    missionYaml('v9-reject', 'impl-reject', './checks/tests-pass.sh'),
  );
  writeFileSync(
    path.join(repo, 'm5.yaml'),
    missionYaml('v9-error', 'impl-error', './checks/tests-pass.sh'),
  );
  writeFileSync(
    path.join(repo, 'm6.yaml'),
    missionYaml(
      'v9-hang',
      'impl-hang',
      './checks/hang.sh',
      '  timeoutMs: 400\nmaxReviewLoops: 0\n',
    ),
  );
  // mission 文件入库：M8 语义——dirty main 拒绝 worktree 创建
  git('add -A');
  git('commit -qm missions');
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(missionsDir, { recursive: true, force: true });
});

describe('M9 e2e：验证门与审阅循环', () => {
  it('SC-001 验收锚点：自报 tests passed + 真实检查失败 → 判定只取 Artifact', async () => {
    const run = await runFleet('m1.yaml', [
      'reason=self-report-cli.sh',
      'wisdom=review-approved-cli.sh', // 审阅者本会批准——判定根本轮不到它
    ]);
    expect(run.exitCode).toBe(1);
    const node = nodeOf(run, 'impl-anchor');
    expect(node?.failureReason).toContain('review_exceeded');
    expect(node?.attempts).toBe(1); // 确定性结论不重试（默认轮次 2 → 2 轮修复）
    const pkg = reviewPackageOf(run, 'impl-anchor');
    expect(pkg).toMatchObject({ terminal: 'review_exceeded', rounds: 2 });
    const artifacts = pkg?.artifacts as Array<{
      checks: Array<{ kind: string; status: string }>;
      overall: string;
    }>;
    expect(artifacts).toHaveLength(3); // loop 0/1/2 全验证失败
    expect(artifacts[0]!.checks.find((c) => c.kind === 'tests')!.status).toBe(
      'fail',
    );
    // 自报零影响：主分支零合并、实现产物不出现在主仓
    expect(existsSync(path.join(repo, 'impl-anchor.txt'))).toBe(false);
    expect(git('log --oneline --grep=impl-anchor')).toBe('');
    expect(git('status --porcelain').trim()).toBe('');
  });

  it('SC-004 正侧：验证通过 + 审阅批准 → merged + 主分支含变更', async () => {
    const run = await runFleet('m2.yaml', [
      'reason=self-report-cli.sh',
      'wisdom=review-approved-cli.sh',
    ]);
    expect(run.exitCode).toBe(0);
    const pkg = reviewPackageOf(run, 'impl-pass');
    expect(pkg).toMatchObject({ terminal: 'approved', rounds: 0 });
    expect(existsSync(path.join(repo, 'impl-pass.txt'))).toBe(true); // merged
    const workspaces = run.json.workspaces as Array<{
      taskId: string;
      action: string;
      outcome?: string;
    }>;
    expect(workspaces.find((w) => w.taskId === 'impl-pass')).toMatchObject({
      action: 'merged',
      outcome: 'approved',
    });
  });

  it('SC-003 一轮修复后通过：reject → 修复 → approved（rounds=1，全轮次可追溯）', async () => {
    rmSync(flipFile, { force: true });
    const run = await runFleet(
      'm3.yaml',
      ['reason=self-report-cli.sh', 'wisdom=review-reject-cli.sh'],
      [],
      { FAKE_REVIEW_FLIP_FILE: flipFile },
    );
    expect(run.exitCode).toBe(0);
    const pkg = reviewPackageOf(run, 'impl-flip');
    expect(pkg).toMatchObject({ terminal: 'approved', rounds: 1 });
    expect(pkg?.artifacts).toHaveLength(2);
    expect(pkg?.verdicts).toHaveLength(2);
    const verdicts = pkg?.verdicts as Array<{ verdict: string }>;
    expect(verdicts.map((v) => v.verdict)).toEqual([
      'changes_requested',
      'approved',
    ]);
  });

  it('SC-003 超限 + SC-005 事件：连续 reject → 第 2 轮修复后 review_exceeded，无第 3 轮修复/第 4 次审阅', async () => {
    const run = await runFleet('m4.yaml', [
      'reason=self-report-cli.sh',
      'wisdom=review-reject-cli.sh',
    ]);
    expect(run.exitCode).toBe(1);
    const pkg = reviewPackageOf(run, 'impl-reject');
    expect(pkg).toMatchObject({ terminal: 'review_exceeded', rounds: 2 });
    expect(pkg?.verdicts).toHaveLength(3); // 审阅 = 修复 + 1
    expect(nodeOf(run, 'impl-reject')?.attempts).toBe(1);
    expect(git('log --oneline --grep=impl-reject')).toBe(''); // 零 merge

    // 事件重放（SC-005）：计数恰 3 次验证完成 + 3 次审阅完成 + 1 次超限
    const types = run.events.map((event) => event.type as string);
    const count = (prefix: string): number =>
      types.filter((type) => type === prefix).length;
    expect(count('task.validation.completed')).toBe(3);
    expect(count('task.review.completed')).toBe(3);
    expect(count('task.review.exceeded')).toBe(1);
    // 事件结构可 round-trip（重放原料）且含 loop / verdict
    const reviewCompleted = run.events.filter(
      (event) => event.type === 'task.review.completed',
    ) as Array<{ payload: Record<string, unknown> }>;
    expect(
      reviewCompleted.map((event) => (event.payload as { loop?: number }).loop),
    ).toEqual([0, 1, 2]);
    expect(git('status --porcelain').trim()).toBe('');
  });

  it('SC-006 review_error：审阅输出乱码 → fail-closed 失败零合并', async () => {
    const run = await runFleet('m5.yaml', [
      'reason=self-report-cli.sh',
      'wisdom=garbage-review-cli.sh',
    ]);
    expect(run.exitCode).toBe(1);
    const node = nodeOf(run, 'impl-error');
    expect(node?.failureReason).toContain('review_error');
    expect(reviewPackageOf(run, 'impl-error')).toMatchObject({
      terminal: 'review_error',
    });
    expect(git('log --oneline --grep=impl-error')).toBe('');
  });

  it('timeout 路径：hang 检查 → status=timeout 按 fail 计（SC-002 矩阵 e2e）', async () => {
    const run = await runFleet('m6.yaml', [
      'reason=self-report-cli.sh',
      'wisdom=review-approved-cli.sh',
    ]);
    expect(run.exitCode).toBe(1);
    const pkg = reviewPackageOf(run, 'impl-hang');
    const artifacts = pkg?.artifacts as Array<{
      checks: Array<{ kind: string; status: string }>;
    }>;
    expect(artifacts[0]!.checks.find((c) => c.kind === 'tests')!.status).toBe(
      'timeout',
    );
  });

  it('逃生口：--no-validation-gate 回退 M8 auto（成功即合）；--no-worktree 回退 M7', async () => {
    const noGate = await runFleet(
      'm1.yaml',
      ['reason=self-report-cli.sh', 'wisdom=review-approved-cli.sh'],
      ['--no-validation-gate'],
    );
    expect(noGate.exitCode).toBe(0); // 检查会失败但门已关——auto 成功即合
    expect(existsSync(path.join(repo, 'impl-anchor.txt'))).toBe(true);
    expect(noGate.json.reviews).toBeUndefined();

    const noWorktree = await runFleet(
      'm2.yaml',
      ['reason=self-report-cli.sh', 'wisdom=review-approved-cli.sh'],
      ['--no-worktree'],
    );
    expect(noWorktree.exitCode).toBe(0); // M7 直通（无门无 worktree）
    expect(noWorktree.json.workspaces).toBeUndefined();
    expect(noWorktree.json.reviews).toBeUndefined();
    rmSync(path.join(repo, 'impl-pass.txt'), { force: true });
  });
});
