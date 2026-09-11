import type { AgentRole } from '@fleet/mission';
import {
  assertPermissionEnv,
  ROLE_PERMISSIONS,
  type PermissionAssertion,
  type RuntimeRequest,
} from '@fleet/runtime';

/**
 * Tool Policy 面（宪法 II）：矩阵与枚举级入口校验的单一来源在
 * @fleet/runtime（Fake / bridge / CLI 适配器共用）；本模块是
 * agents 侧的策略面——补角色一致性断言并对外统一导出。
 */

export {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  REQUEST_PERMISSION_ENV,
  permissionOf,
} from '@fleet/runtime';
export type { Permission, PermissionAssertion } from '@fleet/runtime';

export const REQUEST_ROLE_ENV = 'FLEET_AGENT_ROLE';

/** 枚举级（适配器入口）+ 角色一致性（矩阵级）双重断言 */
export function assertRequestPermission(
  request: RuntimeRequest,
): PermissionAssertion {
  const base = assertPermissionEnv(request);
  if (!base.ok) {
    return base;
  }
  const role = request.env?.FLEET_AGENT_ROLE as AgentRole | undefined;
  const declared = request.env?.FLEET_PERMISSION;
  if (
    role !== undefined &&
    role in ROLE_PERMISSIONS &&
    ROLE_PERMISSIONS[role] !== declared
  ) {
    return {
      ok: false,
      reason: `权限与角色不符：${role} 应为 ${ROLE_PERMISSIONS[role]}，实际声明 ${declared}`,
    };
  }
  return { ok: true };
}
