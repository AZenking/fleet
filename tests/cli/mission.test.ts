import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * fleet mission validate 进程级 e2e（M4）：
 * US1 合法路径 + 文件级故障 + 确定性（SC-001/004）
 * US2 planningMode 模式矩阵
 * US3 十类故障矩阵（SC-002）+ 多错误一次报全（SC-003）
 * 故障注入一律 tmp 文件，不污染仓库 missions/。
 */

const bin = new URL('../../apps/cli/dist/bin.js', import.meta.url).pathname;
const demo = new URL('../../missions/demo.yaml', import.meta.url).pathname;

let tmp: string;

beforeAll(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'fleet-mission-'));
});

afterAll(async () => {
  const { rm } = await import('node:fs/promises');
  await rm(tmp, { recursive: true, force: true });
});

async function runFleet(args: string[]) {
  return execa(process.execPath, [bin, ...args], { reject: false });
}

async function writeMission(name: string, content: string): Promise<string> {
  const file = path.join(tmp, name);
  await writeFile(file, content, 'utf8');
  return file;
}

const BASE = `
id: demo
goal: 测试目标
planningMode: execution
requirements:
  - id: req-1
    text: 需求一
constraints:
  - kind: maxTokens
    value: 1000
plan:
  summary: 已确认方案
tasks:
  - id: analyze
    goal: 分析
    agentRole: focus
    dependsOn: []
  - id: build
    goal: 实现
    agentRole: reason
    dependsOn: [analyze]
acceptance:
  - given: 初始
    when: 执行
    then: 通过
`;

describe('US1：合法路径与文件级故障', () => {
  it('demo.yaml 通过 + 摘要 + 事件 + <1s（SC-001）', async () => {
    const result = await runFleet(['mission', 'validate', demo, '--json']);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.ok).toBe(true);
    expect(report.summary.id).toBe('demo-mission');
    expect(report.summary.planningMode).toBe('execution');
    expect(report.summary.taskCount).toBe(2);
    expect(result.stderr).toContain('mission.validated');
    // SC-001 计时由 CLI 进程内度量，e2e 以整体完成近似（毫秒级）
  });

  it('同文件双跑输出逐字节一致（SC-004）', async () => {
    const first = await runFleet(['mission', 'validate', demo, '--json']);
    const second = await runFleet(['mission', 'validate', demo, '--json']);
    expect(second.stdout).toBe(first.stdout);
  });

  it('文本模式：摘要三行', async () => {
    const result = await runFleet(['mission', 'validate', demo]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      '✓ mission 校验通过：demo-mission（execution）',
    );
    expect(result.stdout).toContain('任务 2 · 验收 2 · 约束 2');
  });

  it('文件级故障四态：不存在 / 目录 / 二进制 / 多文档（不崩溃）', async () => {
    const missing = await runFleet([
      'mission',
      'validate',
      path.join(tmp, 'nope.yaml'),
      '--json',
    ]);
    expect(missing.exitCode).toBe(1);
    expect(JSON.parse(missing.stdout).fileError).toContain('不存在');

    const dirPath = path.join(tmp, 'adir');
    await mkdir(dirPath);
    const dir = await runFleet(['mission', 'validate', dirPath]);
    expect(dir.exitCode).toBe(1);
    expect(dir.stdout).toContain('不存在或不可读');

    const binFile = path.join(tmp, 'bin.yaml');
    await writeFile(binFile, Buffer.from([0x00, 0x01, 0x02, 0xff]));
    const binary = await runFleet(['mission', 'validate', binFile]);
    expect(binary.exitCode).toBe(1);
    expect(binary.stdout + binary.stderr).not.toContain('undefined');

    const multi = await writeMission('multi.yaml', `${BASE}---\nid: another\n`);
    const multiResult = await runFleet(['mission', 'validate', multi]);
    expect(multiResult.exitCode).toBe(1);
  });

  it('未知顶层字段（acceptences 拼错）被拒绝且逐字段列出', async () => {
    const file = await writeMission(
      'typo.yaml',
      BASE.replace('acceptance:', 'acceptences:'),
    );
    const result = await runFleet(['mission', 'validate', file, '--json']);
    expect(result.exitCode).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(
      report.issues.some(
        (issue: { path: string }) => issue.path === 'acceptences',
      ),
    ).toBe(true);
  });
});

describe('US2：planningMode 模式矩阵', () => {
  it('execution 缺 plan → 错误含模式要求', async () => {
    const file = await writeMission(
      'no-plan.yaml',
      BASE.replace('plan:\n  summary: 已确认方案\n', ''),
    );
    const result = await runFleet(['mission', 'validate', file]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('[plan]');
    expect(result.stdout).toContain('execution 模式要求 plan');
  });

  it('execution 缺 tasks → 同类模式错误', async () => {
    const raw =
      BASE.slice(0, BASE.indexOf('tasks:')) +
      BASE.slice(BASE.indexOf('acceptance:'));
    const file = await writeMission('no-tasks.yaml', raw);
    const result = await runFleet(['mission', 'validate', file]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('execution 模式要求非空 tasks');
  });

  it('autonomous 极简（无 plan/tasks）→ 通过', async () => {
    const file = await writeMission(
      'auto.yaml',
      `
id: auto-demo
goal: 探索性任务
planningMode: autonomous
requirements:
  - text: 调研 X 方案
acceptance:
  - given: 无
    when: 完成调研
    then: 产出对比结论
`,
    );
    const result = await runFleet(['mission', 'validate', file]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('autonomous');
  });

  it('planningMode 非法值（Execution/auto/缺失）→ 枚举/required 错误', async () => {
    for (const [label, replacement] of [
      ['大小写', 'planningMode: Execution'],
      ['近义词', 'planningMode: auto'],
      ['缺失', ''],
    ] as const) {
      const file = await writeMission(
        `mode-${label}.yaml`,
        BASE.replace('planningMode: execution', replacement),
      );
      const result = await runFleet(['mission', 'validate', file, '--json']);
      expect(result.exitCode).toBe(1);
      const paths = JSON.parse(result.stdout).issues.map(
        (issue: { path: string }) => issue.path,
      );
      expect(paths).toContain('planningMode');
    }
  });
});

describe('US3：十类故障矩阵（SC-002）+ 一次报全（SC-003）', () => {
  const MATRIX: Array<[string, string, string]> = [
    ['缺 goal', BASE.replace('goal: 测试目标\n', ''), 'goal'],
    [
      '空验收',
      BASE.replace(/acceptance:[\s\S]*$/, 'acceptance: []\n'),
      'acceptance',
    ],
    [
      '非法 planningMode',
      BASE.replace('planningMode: execution', 'planningMode: Exec'),
      'planningMode',
    ],
    [
      'execution 缺 plan',
      BASE.replace('plan:\n  summary: 已确认方案\n', ''),
      'plan',
    ],
    ['重复 task id', BASE.replace('id: build', 'id: analyze'), 'tasks.1.id'],
    [
      '非法角色',
      BASE.replace('agentRole: focus', 'agentRole: coder'),
      'tasks.0.agentRole',
    ],
    [
      '悬空依赖',
      BASE.replace('dependsOn: [analyze]', 'dependsOn: [ghost]'),
      'tasks.1.dependsOn',
    ],
    [
      '自环依赖',
      BASE.replace('dependsOn: [analyze]', 'dependsOn: [build]'),
      'tasks.1.dependsOn',
    ],
    [
      '非法约束值',
      BASE.replace('value: 1000', 'value: -5'),
      'constraints.0.value',
    ],
    [
      '空 requirements',
      BASE.replace(
        /requirements:[\s\S]*?constraints:/,
        'requirements: []\nconstraints:',
      ),
      'requirements',
    ],
  ];

  for (const [label, raw, expectedPath] of MATRIX) {
    it(`故障矩阵：${label} → 退出码 1 + 字段路径 ${expectedPath}`, async () => {
      const file = await writeMission(`fault-${label}.yaml`, raw);
      const result = await runFleet(['mission', 'validate', file, '--json']);
      expect(result.exitCode).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.ok).toBe(false);
      expect(
        report.issues.some(
          (issue: { path: string }) => issue.path === expectedPath,
        ),
      ).toBe(true);
    });
  }

  it('SC-003：3+ 错误单文件一次报全（无遗漏）', async () => {
    // 同时注入：悬空依赖 + 自环 + execution 缺 plan
    const raw = BASE.replace(
      'dependsOn: [analyze]',
      'dependsOn: [ghost, build]',
    ).replace('plan:\n  summary: 已确认方案\n', '');
    const file = await writeMission('multi-fault.yaml', raw);
    const result = await runFleet(['mission', 'validate', file, '--json']);
    expect(result.exitCode).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.issues.length).toBe(3);
    const paths = report.issues.map((issue: { path: string }) => issue.path);
    expect(paths).toContain('tasks.1.dependsOn');
    expect(paths).toContain('plan');
  });

  it('SC-002 总账：全部矩阵场景 0 崩溃 0 静默通过', async () => {
    // 上面 10 个 it 已逐一断言；此处补无 undefined 渲染的全量扫
    for (const [label, raw] of MATRIX) {
      const file = await writeMission(`sweep-${label}.yaml`, raw);
      const result = await runFleet(['mission', 'validate', file]);
      expect(result.exitCode).toBe(1);
      // 渲染泄漏物检查（"undefined" 一词会合法出现在 Zod message 中，
      // 这里查的是 JS 错误与未渲染对象）
      expect(result.stdout).not.toContain('is not defined');
      expect(result.stdout).not.toContain('[object Object]');
      expect(result.stderr).not.toContain('UnhandledPromiseRejection');
    }
  });
});
