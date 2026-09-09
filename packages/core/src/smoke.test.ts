import { describe, expect, it } from 'vitest';
import { CORE_READY } from './index.js';

describe('@fleet/core smoke', () => {
  it('exports a working entry point', () => {
    expect(CORE_READY).toBe(true);
  });
});
