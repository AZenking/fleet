import type { RuntimeRequest } from './types.js';

import { CliRuntimeAdapter } from './cli-adapter.js';

/**
 * 三薄适配器（research.md D5）：pi 按本机 0.85.1 实测；codex /
 * gemini 按公开非交互形态落参数模板（实现期探测校准制）。
 * 权限约束翻译 = 提示词权限段（全部 CLI 可行的最大公共项）。
 */

function permissionDirective(request: RuntimeRequest): string {
  const role = request.env?.FLEET_AGENT_ROLE ?? 'unknown-role';
  const permission = request.env?.FLEET_PERMISSION ?? 'unknown-permission';
  const scope =
    permission === 'READ_ONLY'
      ? '你处于只读模式：不得创建、修改或删除任何文件；只输出调查 / 分析结论。'
      : permission === 'LIGHT_WRITE'
        ? '你处于轻量写模式：仅允许琐碎小改动，禁止大范围修改与重构。'
        : '你处于深度写模式：你是本任务唯一被授权深度修改代码的角色。';
  return `Fleet 权限约束：角色 ${role}，权限 ${permission}。${scope}`;
}

/** pi：非交互一次执行（实测 0.85.1） */
export class PiCliRuntime extends CliRuntimeAdapter {
  constructor(options: { env?: Record<string, string> } = {}) {
    super({
      name: 'pi',
      command: 'pi',
      buildArgs: (request) => [
        '-p',
        '--mode',
        'text',
        '--no-session',
        '--append-system-prompt',
        permissionDirective(request),
        '--',
        request.prompt,
      ],
      ...options,
    });
  }
}

/** codex：非交互执行（参数模板，探测校准制） */
export class CodexCliRuntime extends CliRuntimeAdapter {
  constructor(options: { env?: Record<string, string> } = {}) {
    super({
      name: 'codex',
      command: 'codex',
      buildArgs: (request) => [
        'exec',
        '--sandbox',
        request.env?.FLEET_PERMISSION === 'READ_ONLY'
          ? 'read-only'
          : 'workspace-write',
        '-',
        `${permissionDirective(request)}\n\n${request.prompt}`,
      ],
      ...options,
    });
  }
}

/** gemini：非交互执行（参数模板，探测校准制） */
export class GeminiCliRuntime extends CliRuntimeAdapter {
  constructor(options: { env?: Record<string, string> } = {}) {
    super({
      name: 'gemini',
      command: 'gemini',
      buildArgs: (request) => [
        '-p',
        `${permissionDirective(request)}\n\n${request.prompt}`,
      ],
      ...options,
    });
  }
}

export { permissionDirective };
