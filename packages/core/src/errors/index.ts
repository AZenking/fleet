/**
 * FleetError — 全部 core 能力的唯一错误类型（data-model.md §4）。
 *
 * 配置校验失败时 context.issues 携带逐字段问题数组（FR-007）。
 */

export const ErrorCodes = {
  CONFIG_MISSING: 'CONFIG_MISSING',
  CONFIG_EMPTY: 'CONFIG_EMPTY',
  CONFIG_INVALID: 'CONFIG_INVALID',
  NOT_A_GIT_REPO: 'NOT_A_GIT_REPO',
  PROBE_FAILED: 'PROBE_FAILED',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export type FleetErrorCategory = 'config' | 'environment' | 'internal';

export interface ConfigIssue {
  /** 点分字段路径，如 defaults.maxConcurrency；根级为 <root> */
  path: string;
  /** 期望的形态（如 integer in 1..64 的等价描述或规则码） */
  expected: string;
  /** 实际得到的值或状态 */
  received: string;
  /** 一句人话说明 */
  message: string;
}

export interface FleetErrorContext {
  [key: string]: unknown;
}

export class FleetError extends Error {
  readonly code: string;
  readonly category: FleetErrorCategory;
  readonly context: FleetErrorContext;

  constructor(
    code: string,
    category: FleetErrorCategory,
    message: string,
    context: FleetErrorContext = {},
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'FleetError';
    this.code = code;
    this.category = category;
    this.context = context;
  }
}
