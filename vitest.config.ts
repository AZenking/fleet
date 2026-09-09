import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'core',
          include: ['packages/core/src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'repository',
          include: ['packages/repository/src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'cli-e2e',
          include: ['tests/cli/**/*.test.ts'],
          testTimeout: 120_000,
        },
      },
    ],
  },
});
