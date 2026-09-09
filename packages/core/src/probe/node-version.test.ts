import { describe, expect, it } from 'vitest';
import { satisfiesNodeVersion } from './node-version.js';

describe('satisfiesNodeVersion', () => {
  it('满足范围', () => {
    expect(satisfiesNodeVersion('v24.3.0', '>=24')).toBe(true);
  });

  it('低于最低版本不满足（quickstart 注入 #1）', () => {
    expect(satisfiesNodeVersion('v23.11.0', '>=24')).toBe(false);
  });

  it('恰好等于最低版本判定通过（spec 边界：>= 语义）', () => {
    expect(satisfiesNodeVersion('v24.0.0', '>=24')).toBe(true);
  });

  it('无法解析的版本串按不满足处理', () => {
    expect(satisfiesNodeVersion('not-a-version', '>=24')).toBe(false);
  });
});
