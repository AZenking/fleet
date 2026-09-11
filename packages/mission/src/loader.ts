import { parse as parseYaml } from 'yaml';
import type { ZodError } from 'zod';

import { FleetError, type ConfigIssue } from '@fleet/core';

import { missionSchema, type Mission } from './types.js';

/**
 * mission 加载器（research.md D2/D3）：复刻 core config 模式——
 * raw YAML → strictObject → FleetError + ConfigIssue[]（逐字段定位，
 * unrecognized_keys 展开为逐字段问题）。mission 专属错误码借
 * FleetError 的开放 code，零侵入 core。
 */

export const MissionErrorCodes = {
  MISSION_FILE_MISSING: 'MISSION_FILE_MISSING',
  MISSION_FILE_UNREADABLE: 'MISSION_FILE_UNREADABLE',
  MISSION_PARSE_FAILED: 'MISSION_PARSE_FAILED',
  MISSION_INVALID: 'MISSION_INVALID',
} as const;

export type MissionErrorCode =
  (typeof MissionErrorCodes)[keyof typeof MissionErrorCodes];

export interface LoadMissionOptions {
  /** 报错与 context 中展示的来源路径 */
  sourcePath?: string;
}

export function loadMission(
  raw: string | undefined,
  options: LoadMissionOptions = {},
): Mission {
  const source = options.sourcePath ?? '<mission>';

  if (raw === undefined) {
    throw new FleetError(
      MissionErrorCodes.MISSION_FILE_MISSING,
      'config',
      `mission 文件缺失：${source}`,
      { source },
    );
  }
  if (raw.trim() === '') {
    throw new FleetError(
      MissionErrorCodes.MISSION_FILE_UNREADABLE,
      'config',
      `mission 文件为空：${source}`,
      { source },
    );
  }

  let data: unknown;
  try {
    data = parseYaml(raw);
  } catch (cause) {
    throw new FleetError(
      MissionErrorCodes.MISSION_PARSE_FAILED,
      'config',
      `mission YAML 解析失败：${source}`,
      {
        source,
        issues: [
          {
            path: '<root>',
            expected: '合法 YAML（单文档）',
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
      MissionErrorCodes.MISSION_PARSE_FAILED,
      'config',
      `mission 结构错误：${source}`,
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

  const parsed = missionSchema.safeParse(data);
  if (!parsed.success) {
    throw new FleetError(
      MissionErrorCodes.MISSION_INVALID,
      'config',
      `mission 校验失败：${source}`,
      { source, issues: toIssues(parsed.error) },
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

/** Zod issues → ConfigIssue（unrecognized_keys 逐字段展开，对齐 config loader） */
export function toIssues(error: ZodError): ConfigIssue[] {
  const result: ConfigIssue[] = [];
  for (const issue of error.issues) {
    const extra = issue as unknown as Record<string, unknown>;
    if (issue.code === 'unrecognized_keys' && Array.isArray(extra['keys'])) {
      for (const key of extra['keys'] as unknown[]) {
        result.push({
          path: String(key),
          expected: '已定义字段（见 contracts/mission-file.md）',
          received: '未知字段',
          message: `未知字段：${String(key)}（拼写错误会被拒绝，不静默丢失）`,
        });
      }
      continue;
    }
    result.push({
      path: issue.path.length > 0 ? issue.path.map(String).join('.') : '<root>',
      expected: describeExpected(issue),
      received: describeReceived(issue),
      message: issue.message,
    });
  }
  return result;
}

/** 把 Zod 术语翻译为人话（SC-005：错误自解释） */
function describeExpected(issue: unknown): string {
  const record = issue as Record<string, unknown>;
  const code = record['code'];
  if (code === 'invalid_enum_value' || code === 'invalid_value') {
    // Zod v4 枚举错误：options（v3）或 values（v4）任一存在即用
    const options = Array.isArray(record['options'])
      ? (record['options'] as unknown[])
      : Array.isArray(record['values'])
        ? (record['values'] as unknown[])
        : undefined;
    return options !== undefined
      ? options.map((option) => String(option)).join(' | ')
      : '合法枚举值';
  }
  switch (code) {
    case 'too_small':
      return '不少于最小值';
    case 'too_big':
      return '不超过最大值';
    case 'invalid_type': {
      const expected = record['expected'];
      return expected !== undefined ? String(expected) : '合法类型';
    }
    case 'invalid_format':
    case 'invalid_string':
      return '符合格式要求';
    default: {
      const expected = record['expected'];
      return typeof expected === 'string' ? expected : String(code ?? '合法值');
    }
  }
}

function describeReceived(issue: unknown): string {
  const record = issue as Record<string, unknown>;
  if (record['input'] !== undefined) {
    const input = record['input'];
    if (typeof input === 'string') {
      return input === '' ? '空字符串' : input;
    }
    if (typeof input === 'number' || typeof input === 'boolean') {
      return String(input);
    }
    if (input === null) {
      return 'null';
    }
    if (Array.isArray(input)) {
      return `数组（${input.length} 项）`;
    }
  }
  return '<invalid>';
}
