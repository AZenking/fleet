import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { Mission } from '@fleet/mission';

import {
  DEFAULT_CHECK_TIMEOUT_MS,
  DEFAULT_MAX_REVIEW_LOOPS,
  type CommandKind,
  type ValidationProfile,
} from './types.js';

/**
 * Profile 解析链（research.md D5）：mission.validation.commands
 * 显式（= 必选）→ 目标 worktree 的 package.json scripts 探测
 * （探测到 = 必选）→ skipped（not-configured）。包管理器按
 * lockfile 识别——探测面向"命令存在性"，不绑定具体工具链
 * （宪法 VI：Fleet 验收仓库自身约定，不自带 linter）。
 */

const SCRIPT_OF: Record<CommandKind, string> = {
  lint: 'lint',
  typecheck: 'typecheck',
  tests: 'test',
};

export function resolveValidationProfile(
  mission: Mission,
  workspacePath: string,
): ValidationProfile {
  const explicit = mission.validation?.commands ?? {};
  const detected = detectScripts(workspacePath);
  const pm = detectPackageManager(workspacePath);
  const checks = {} as ValidationProfile['checks'];
  for (const kind of Object.keys(SCRIPT_OF) as CommandKind[]) {
    const configured = explicit[kind];
    if (configured !== undefined) {
      checks[kind] = { command: configured, required: true };
      continue;
    }
    const script = detected[SCRIPT_OF[kind]];
    checks[kind] =
      script !== undefined
        ? {
            command:
              kind === 'tests' ? `${pm} test` : `${pm} run ${SCRIPT_OF[kind]}`,
            required: true,
          }
        : { required: false };
  }
  return {
    checks,
    timeoutMs: mission.validation?.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS,
    maxReviewLoops: mission.maxReviewLoops ?? DEFAULT_MAX_REVIEW_LOOPS,
  };
}

function detectScripts(workspacePath: string): Record<string, unknown> {
  const manifest = path.join(workspacePath, 'package.json');
  if (!existsSync(manifest)) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf8'));
    const scripts = (parsed as { scripts?: unknown }).scripts;
    return typeof scripts === 'object' && scripts !== null
      ? (scripts as Record<string, unknown>)
      : {};
  } catch {
    return {}; // 损坏的 manifest 按未探测处理（不阻断验证）
  }
}

function detectPackageManager(workspacePath: string): 'pnpm' | 'yarn' | 'npm' {
  if (existsSync(path.join(workspacePath, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (existsSync(path.join(workspacePath, 'yarn.lock'))) {
    return 'yarn';
  }
  return 'npm';
}
