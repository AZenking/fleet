import { existsSync } from 'node:fs';
import path from 'node:path';
import { ErrorCodes, FleetError } from '../errors/index.js';

/**
 * Git 仓库检测：自 startDir 向上查找 .git，返回仓库根绝对路径。
 * isGitRoot 可注入，用于不触碰真实磁盘的测试（FR-010 精神）。
 */

export type GitRootProbe = (dir: string) => boolean;

export function findGitRepo(
  startDir: string,
  isGitRoot: GitRootProbe = defaultIsGitRoot,
): string {
  let dir = path.resolve(startDir);
  for (;;) {
    if (isGitRoot(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new FleetError(
        ErrorCodes.NOT_A_GIT_REPO,
        'environment',
        `非 git 仓库：${startDir}`,
        { startDir },
      );
    }
    dir = parent;
  }
}

const defaultIsGitRoot: GitRootProbe = (dir) =>
  existsSync(path.join(dir, '.git'));
