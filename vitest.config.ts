import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 并行限流：git 子进程风暴型测试（workspace/e2e）在满并发下
    // 互相争资源导致超时假失败——上限 4 worker 保稳定优先
    maxWorkers: 4,
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
          name: 'mission',
          include: ['packages/mission/src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'scheduler',
          include: ['packages/scheduler/src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'runtime',
          include: ['packages/runtime/src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'agents',
          include: ['packages/agents/src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'workspace',
          include: ['packages/workspace/src/**/*.test.ts'],
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'validation',
          include: ['packages/validation/src/**/*.test.ts'],
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'budget',
          include: ['packages/budget/src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'context',
          include: ['packages/context/src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'observability',
          include: ['packages/observability/src/**/*.test.ts'],
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'mcp',
          include: ['packages/mcp/src/**/*.test.ts'],
          testTimeout: 30_000,
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
