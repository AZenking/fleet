import { execa } from 'execa';

import { CliRuntimeAdapter } from './cli-adapter.js';

/**
 * 运行时可用性探测（research.md D6）：命令存在 + 版本可达；
 * doctor 的 Agent Runtime 检查同源消费（防两处漂移）。
 */

export interface RuntimeAvailability {
  name: string;
  available: boolean;
  version?: string;
  installHint: string;
}

export const INSTALL_HINTS: Record<string, string> = {
  codex: '安装 Codex CLI（参见 OpenAI Codex 文档）',
  gemini: '安装 Gemini CLI（npm i -g @google/gemini-cli）',
  pi: '安装 pi（参见 pi 项目文档）',
};

export async function probeRuntime(
  adapterOrName: CliRuntimeAdapter | string,
): Promise<RuntimeAvailability> {
  const name =
    typeof adapterOrName === 'string'
      ? adapterOrName
      : adapterOrName.config.name;
  if (name === 'fake') {
    return { name, available: true, installHint: '内置 Fake 运行时' };
  }
  if (typeof adapterOrName === 'string') {
    // 只有名字（未构造 adapter）：命令名即名义，直接探测
    return probeCommand(name, name);
  }
  const availability = await probeCommand(adapterOrName.config.command, name);
  return { ...availability, version: availability.version ?? undefined };
}

async function probeCommand(
  command: string,
  name: string,
): Promise<RuntimeAvailability> {
  try {
    const result = await execa(command, ['--version'], {
      timeout: 3000,
      reject: false,
      stdin: 'ignore',
    });
    if (result.exitCode !== 0) {
      return unavailable(name);
    }
    const version = result.stdout.split('\n')[0]?.trim();
    return {
      name,
      available: true,
      ...(version !== '' ? { version } : {}),
      installHint: '',
    };
  } catch {
    return unavailable(name);
  }
}

function unavailable(name: string): RuntimeAvailability {
  return {
    name,
    available: false,
    installHint: INSTALL_HINTS[name] ?? `安装 ${name} CLI 后重试`,
  };
}
