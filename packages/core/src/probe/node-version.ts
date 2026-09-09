import semver from 'semver';

/**
 * Node 版本满足性检查。engines.node 是最低版本的唯一真源（research.md D4）。
 * 边界：恰好等于最低版本判定通过（>= 语义）。
 */

export function satisfiesNodeVersion(
  currentVersion: string,
  range: string,
): boolean {
  const coerced = semver.coerce(currentVersion);
  if (!coerced) return false;
  return semver.satisfies(coerced, range, { includePrerelease: true });
}
