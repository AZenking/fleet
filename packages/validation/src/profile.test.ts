import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMission } from '@fleet/mission';

import { resolveValidationProfile } from './profile.js';

/** T007：三级解析优先级 / lockfile 识别 / 缺省形态 */

const BASE = `
id: p9
goal: profile
planningMode: execution
requirements:
  - text: 需求
plan:
  summary: 方案
tasks:
  - id: impl
    goal: 实现
    agentRole: reason
acceptance:
  - given: 无
    when: 执行
    then: 完成
`;

function missionOf(extra: string) {
  return loadMission(BASE.replace('acceptance:', `${extra}acceptance:`), {
    sourcePath: '<test>',
  });
}

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'fleet-prof-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('resolveValidationProfile（三级解析）', () => {
  it('无配置 + 无 package.json → 全部 skipped 形态 + 宪法默认值', () => {
    const profile = resolveValidationProfile(missionOf(''), dir);
    expect(profile.checks).toEqual({
      lint: { required: false },
      typecheck: { required: false },
      tests: { required: false },
    });
    expect(profile.timeoutMs).toBe(300_000);
    expect(profile.maxReviewLoops).toBe(2);
  });

  it('package.json scripts 探测（pnpm lockfile）→ 必选命令', () => {
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ scripts: { lint: 'eslint .', test: 'vitest run' } }),
    );
    writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
    const profile = resolveValidationProfile(missionOf(''), dir);
    expect(profile.checks.lint).toEqual({
      command: 'pnpm run lint',
      required: true,
    });
    expect(profile.checks.tests).toEqual({
      command: 'pnpm test',
      required: true,
    });
    expect(profile.checks.typecheck).toEqual({ required: false });
  });

  it('yarn / npm lockfile 识别', () => {
    rmSync(path.join(dir, 'pnpm-lock.yaml'));
    writeFileSync(path.join(dir, 'yarn.lock'), '');
    expect(
      resolveValidationProfile(missionOf(''), dir).checks.lint.command,
    ).toBe('yarn run lint');
    rmSync(path.join(dir, 'yarn.lock'));
    expect(
      resolveValidationProfile(missionOf(''), dir).checks.tests.command,
    ).toBe('npm test');
  });

  it('mission 显式覆盖全参（优先于探测）', () => {
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ scripts: { lint: 'eslint .' } }),
    );
    const mission = missionOf(
      'validation:\n  commands:\n    lint: ./checks/lint.sh\n    tests: ./checks/tests.sh\n  timeoutMs: 1500\nmaxReviewLoops: 0\n',
    );
    const profile = resolveValidationProfile(mission, dir);
    expect(profile.checks.lint).toEqual({
      command: './checks/lint.sh',
      required: true,
    });
    expect(profile.checks.tests).toEqual({
      command: './checks/tests.sh',
      required: true,
    });
    expect(profile.checks.typecheck).toEqual({ required: false });
    expect(profile.timeoutMs).toBe(1500);
    expect(profile.maxReviewLoops).toBe(0); // 纯验证门
  });

  it('损坏 package.json → 按未探测处理（不抛错）', () => {
    writeFileSync(path.join(dir, 'package.json'), '{broken');
    expect(
      resolveValidationProfile(missionOf(''), dir).checks.lint.required,
    ).toBe(false);
  });
});
