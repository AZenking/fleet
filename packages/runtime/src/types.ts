import type { AgentRole } from '@fleet/mission';

/**
 * Runtime 契约实体（data-model.md §1–§4）。
 *
 * 实现方四条合同条款（contracts/runtime-adapter.md，M7 真实
 * Adapter 必须遵守）：异常不逃逸 / timeout 诚实（迟到结果丢弃）/
 * cancel 单次 settle / 清理完备（无悬挂计时器）。
 */

export interface RuntimeRequest {
  /** run_ 前缀；每次执行生成（重试 = 新 runId） */
  runId: string;
  /** agent:<taskId>（M6 Fake 语义；真实 agent 实例属 M7） */
  agentId: string;
  cwd: string;
  /** 确定性模板（Context Builder 属 M10） */
  prompt: string;
  env?: Record<string, string>;
  timeoutMs: number;
}

export const RUNTIME_FAILURE_CODES = ['timeout', 'cancelled', 'error'] as const;
export type RuntimeFailureCode = (typeof RUNTIME_FAILURE_CODES)[number];

export interface RuntimeResult {
  ok: boolean;
  /** ok=false 时必有 */
  code?: RuntimeFailureCode;
  detail?: string;
  /** Fake 模拟输出（脚本提供） */
  output?: string;
}

/** RuntimeAdapter 契约（宪法 IV：Role 与 Runtime 的唯一接缝） */
export interface RuntimeAdapter {
  execute(request: RuntimeRequest): Promise<RuntimeResult>;
  cancel(runId: string): Promise<void>;
}

/** 脚本步：hang = 永不自行完成（timeout/cancel 的注入形态） */
export const FAKE_OUTCOMES = ['success', 'failure', 'error', 'hang'] as const;
export type FakeOutcome = (typeof FAKE_OUTCOMES)[number];

export interface FakeStep {
  outcome: FakeOutcome;
  /** 覆盖角色画像延迟 */
  delayMs?: number;
  output?: string;
}

/** 五角色默认延迟画像（ms）：reflex 快 → wisdom 慢（research.md D3） */
export const ROLE_DELAY_PROFILE_MS: Record<AgentRole, number> = {
  reflex: 15,
  focus: 30,
  reason: 45,
  insight: 30,
  wisdom: 60,
};

/** 默认任务执行预算（mission/task 约束缺省时） */
export const DEFAULT_TASK_TIMEOUT_MS = 5000;

/**
 * 权限声明（请求级必达，宪法 II）：枚举与入口校验在 runtime 层——
 * 任何适配器（Fake / CLI）对裸请求一律拒绝；角色→权限矩阵在
 * @fleet/agents 的 Tool Policy（单一来源）。
 */
export const PERMISSIONS = ['READ_ONLY', 'LIGHT_WRITE', 'DEEP_WRITE'] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const REQUEST_PERMISSION_ENV = 'FLEET_PERMISSION';

/** 宪法 II 矩阵（单一来源）：reflex 轻写 / reason 唯一深写 / 其余只读 */
export const ROLE_PERMISSIONS: Record<AgentRole, Permission> = {
  reflex: 'LIGHT_WRITE',
  focus: 'READ_ONLY',
  reason: 'DEEP_WRITE',
  insight: 'READ_ONLY',
  wisdom: 'READ_ONLY',
};

export function permissionOf(role: AgentRole): Permission {
  return ROLE_PERMISSIONS[role];
}

export interface PermissionAssertion {
  ok: boolean;
  reason?: string;
}

/** 适配器入口强制：env 缺失或非合法枚举 → 拒绝（不启子进程） */
export function assertPermissionEnv(
  request: RuntimeRequest,
): PermissionAssertion {
  const declared = request.env?.[REQUEST_PERMISSION_ENV];
  if (declared === undefined) {
    return {
      ok: false,
      reason: `请求缺少权限声明（env.${REQUEST_PERMISSION_ENV}）——必须经 Tool Policy 构造，裸请求拒绝执行`,
    };
  }
  if (!PERMISSIONS.includes(declared as Permission)) {
    return {
      ok: false,
      reason: `非法权限声明：${declared}（合法值 ${PERMISSIONS.join(' | ')}）`,
    };
  }
  return { ok: true };
}
