import { execa } from 'execa';

/**
 * 命令存在性探测（which 风格语义）：命令可被 spawn 即视为存在，
 * 非零退出码不算不存在。超时按不存在处理，探测方永不挂起。
 *
 * health 级调用（版本、索引状态）是 M1 adapter 的职责，M0 只做存在性。
 */

export async function commandExists(
  command: string,
  timeoutMs = 3000,
): Promise<boolean> {
  try {
    // execa 的 reject:false 对 ENOENT 也 resolve（failed=true，
    // exitCode undefined）——必须以"进程真实运行过"判定存在性
    const result = await execa(command, ['--version'], {
      reject: false,
      timeout: timeoutMs,
    });
    return result.exitCode !== undefined;
  } catch {
    return false;
  }
}

/** 探测一组命令，返回其中存在的那些（保序）。 */
export async function existingCommands(
  commands: readonly string[],
): Promise<string[]> {
  const results = await Promise.all(commands.map((cmd) => commandExists(cmd)));
  return commands.filter((_, i) => results[i]);
}
