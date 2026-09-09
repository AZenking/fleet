import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

const bin = new URL('../../apps/cli/dist/bin.js', import.meta.url).pathname;

describe('fleet cli smoke', () => {
  it('prints version and exits 0', async () => {
    const result = await execa('node', [bin, '--version']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
