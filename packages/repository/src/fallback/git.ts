import { execa } from 'execa';

/**
 * git 元信息辅助（只读）。失败一律返回空——排序加权用途，非关键路径。
 */

export async function recentChangedFiles(
  repoRoot: string,
  days = 7,
): Promise<string[]> {
  try {
    const result = await execa(
      'git',
      ['log', '--name-only', '--pretty=format:', `--since=${days}.days`],
      { cwd: repoRoot, timeout: 3000, reject: false },
    );
    if (result.exitCode !== 0) {
      return [];
    }
    return [
      ...new Set(
        result.stdout
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
      ),
    ];
  } catch {
    return [];
  }
}
