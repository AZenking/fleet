import { parse as parseYaml } from 'yaml';
import type { ZodError } from 'zod';
import { ErrorCodes, FleetError, type ConfigIssue } from '../errors/index.js';
import { fleetConfigSchema, type FleetConfiguration } from './schema.js';

/**
 * 配置加载：raw YAML 文本 → 结构化 FleetConfiguration。
 *
 * 失败路径统一抛 FleetError（CONFIG_MISSING / CONFIG_EMPTY / CONFIG_INVALID），
 * context.issues 逐字段定位问题（contracts/fleet-yaml.md 错误语义）。
 */

export interface LoadConfigOptions {
  /** 报错与 context 中展示的来源路径 */
  sourcePath?: string;
}

export function loadFleetConfig(
  raw: string | undefined,
  options: LoadConfigOptions = {},
): FleetConfiguration {
  const source = options.sourcePath ?? 'configs/fleet.yaml';

  if (raw === undefined) {
    throw new FleetError(
      ErrorCodes.CONFIG_MISSING,
      'config',
      `配置文件缺失：${source}`,
      { source },
    );
  }

  if (raw.trim() === '') {
    throw new FleetError(
      ErrorCodes.CONFIG_EMPTY,
      'config',
      `配置为空：${source}`,
      {
        source,
      },
    );
  }

  let data: unknown;
  try {
    data = parseYaml(raw);
  } catch (cause) {
    throw new FleetError(
      ErrorCodes.CONFIG_INVALID,
      'config',
      `配置 YAML 解析失败：${source}`,
      {
        source,
        issues: [
          {
            path: '<root>',
            expected: '合法 YAML',
            received: '解析错误',
            message: cause instanceof Error ? cause.message : String(cause),
          },
        ],
      },
      { cause },
    );
  }

  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    const received =
      data === null ? 'null' : Array.isArray(data) ? '数组' : typeof data;
    throw new FleetError(
      ErrorCodes.CONFIG_INVALID,
      'config',
      `配置校验失败：${source}`,
      {
        source,
        issues: [
          {
            path: '<root>',
            expected: 'YAML 映射（对象）',
            received,
            message: `顶层应为映射，实际是 ${received}`,
          },
        ],
      },
    );
  }

  const parsed = fleetConfigSchema.safeParse(data);
  if (!parsed.success) {
    throw new FleetError(
      ErrorCodes.CONFIG_INVALID,
      'config',
      `配置校验失败：${source}`,
      { source, issues: toIssues(parsed.error) },
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

function toIssues(error: ZodError): ConfigIssue[] {
  const result: ConfigIssue[] = [];
  for (const issue of error.issues) {
    const extra = issue as unknown as Record<string, unknown>;
    // unrecognized_keys 的 keys 展开为逐字段问题（FR-007 逐字段定位）
    if (issue.code === 'unrecognized_keys' && Array.isArray(extra['keys'])) {
      for (const key of extra['keys'] as unknown[]) {
        result.push({
          path: String(key),
          expected: '已定义字段',
          received: '未知字段',
          message: `未知字段：${String(key)}`,
        });
      }
      continue;
    }
    result.push({
      path: issue.path.length > 0 ? issue.path.map(String).join('.') : '<root>',
      expected:
        typeof extra['expected'] === 'string' ? extra['expected'] : issue.code,
      received:
        typeof extra['received'] === 'string' ? extra['received'] : '<invalid>',
      message: issue.message,
    });
  }
  return result;
}
