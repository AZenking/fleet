import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { ErrorCodes, FleetError } from '../errors/index.js';
import { findGitRepo } from './detect.js';

describe('findGitRepo', () => {
  it('自子目录向上找到标记目录（US3 验收：仓库目录返回根路径）', () => {
    const marker = path.resolve('/tmp', 'fixture-repo');
    const isGitRoot = (dir: string) => dir === marker;
    const found = findGitRepo(path.join(marker, 'a', 'b'), isGitRoot);
    expect(found).toBe(marker);
  });

  it('普通目录抛 NOT_A_GIT_REPO（US3 验收：非仓库明确报错）', () => {
    const isGitRoot = () => false;
    expect(() => findGitRepo('/tmp/nowhere', isGitRoot)).toThrowError(
      FleetError,
    );
    try {
      findGitRepo('/tmp/nowhere', isGitRoot);
    } catch (error) {
      expect((error as FleetError).code).toBe(ErrorCodes.NOT_A_GIT_REPO);
    }
  });

  it('起始于仓库根本身时直接命中', () => {
    const marker = path.resolve('/tmp', 'fixture-repo');
    expect(findGitRepo(marker, (dir) => dir === marker)).toBe(marker);
  });
});
