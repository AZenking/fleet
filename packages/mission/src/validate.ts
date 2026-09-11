import path from 'node:path';

import {
  RealFileSystem,
  FleetError,
  type ConfigIssue,
  type FileSystemPort,
} from '@fleet/core';

import { loadMission } from './loader.js';
import { validateSemantics } from './semantic.js';
import type { Mission } from './types.js';

/**
 * 校验编排（FR-001/007）：读文件 → 结构层（loader）→ 语义层
 * （semantic）→ 两层 issues 一次报全。文件级故障以 fileError
 * 标注返回（不抛异常给 CLI）；结构层失败时语义层无法运行，
 * 报告结构层全部问题。
 */

export interface MissionValidationReport {
  ok: boolean;
  mission?: Mission;
  issues: ConfigIssue[];
  fileError?: string;
}

export interface ValidateFileResult {
  /** true = 报告可用（含失败报告）；false = 文件级故障 */
  handled: boolean;
  report: MissionValidationReport;
}

export function validateMissionContent(
  raw: string | undefined,
  sourcePath: string,
): MissionValidationReport {
  try {
    const mission = loadMission(raw, { sourcePath });
    const issues = validateSemantics(mission);
    return {
      ok: issues.length === 0,
      ...(issues.length === 0 ? { mission } : {}),
      issues,
    };
  } catch (error) {
    if (error instanceof FleetError) {
      const issues = Array.isArray(error.context['issues'])
        ? (error.context['issues'] as ConfigIssue[])
        : [];
      return {
        ok: false,
        issues,
        ...([
          'MISSION_FILE_MISSING',
          'MISSION_FILE_UNREADABLE',
          'MISSION_PARSE_FAILED',
        ].includes(error.code)
          ? { fileError: error.message }
          : {}),
      };
    }
    throw error;
  }
}

export function validateMissionFile(
  missionPath: string,
  fs: FileSystemPort = new RealFileSystem(),
): ValidateFileResult {
  const resolved = path.resolve(missionPath);
  // 目录等不可读目标：readFileOptional 对目录抛 EISDIR，包一层
  let probe: string | undefined;
  try {
    probe = fs.readFileOptional(resolved);
  } catch {
    probe = undefined;
  }
  if (probe === undefined) {
    // 目录或不存在：fileError 明确指出（用法层不判存亡，报告统一）
    return {
      handled: true,
      report: {
        ok: false,
        issues: [],
        fileError: `文件不存在或不可读：${resolved}（需要指向 mission 文件，而非目录）`,
      },
    };
  }
  let raw: string;
  try {
    raw = fs.readFile(resolved);
  } catch (cause) {
    return {
      handled: true,
      report: {
        ok: false,
        issues: [],
        fileError: `文件读取失败：${resolved}（${cause instanceof Error ? cause.message : String(cause)}）`,
      },
    };
  }
  return { handled: true, report: validateMissionContent(raw, resolved) };
}
