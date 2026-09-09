import path from 'node:path';
import type { FileSystemPort } from '@fleet/core';
import type { Reference } from '../investigation/types.js';

/**
 * 源码阅读与锚定校验（Static Truth，FR-008 / SC-004）。
 * codegraph 引用必须回读源码验证；不一致时以源码为准（conflict）。
 */

export interface AnchorOutcome {
  reference: Reference;
  /** true = 锚点与源码不一致，已修正或降级 */
  conflict: boolean;
}

export function makeSnippet(
  lines: string[],
  startLine: number,
  maxLines = 5,
): string {
  const chunk = lines.slice(startLine - 1, startLine - 1 + maxLines);
  return chunk.length === 0 ? '' : chunk.join('\n');
}

function findSymbolLine(
  lines: string[],
  symbol: string | undefined,
  around: number,
): number | undefined {
  if (symbol === undefined) {
    return undefined;
  }
  for (let offset = 0; offset <= 5; offset++) {
    for (const candidate of [around + offset, around - offset]) {
      if (candidate < 1) {
        continue;
      }
      const line = lines[candidate - 1];
      if (line !== undefined && line.includes(symbol)) {
        return candidate;
      }
    }
  }
  return undefined;
}

export function verifyAnchor(
  fs: FileSystemPort,
  repoRoot: string,
  reference: Reference,
): AnchorOutcome | undefined {
  const absolute = path.join(repoRoot, reference.filePath);
  let content: string;
  try {
    content = fs.readFile(absolute);
  } catch {
    return undefined;
  }
  const lines = content.split('\n');

  const targetLine = lines[reference.startLine - 1];
  const symbolNearby = findSymbolLine(
    lines,
    reference.symbol,
    reference.startLine,
  );

  if (targetLine === undefined || targetLine.trim() === '') {
    if (symbolNearby !== undefined) {
      return {
        reference: {
          ...reference,
          startLine: symbolNearby,
          endLine: Math.max(
            symbolNearby,
            reference.endLine - reference.startLine + symbolNearby,
          ),
          snippet: makeSnippet(lines, symbolNearby),
          verified: true,
        },
        conflict: true,
      };
    }
    return undefined;
  }

  if (
    reference.symbol !== undefined &&
    symbolNearby !== undefined &&
    symbolNearby !== reference.startLine
  ) {
    return {
      reference: {
        ...reference,
        startLine: symbolNearby,
        endLine: symbolNearby,
        snippet: makeSnippet(lines, symbolNearby),
        verified: true,
      },
      conflict: true,
    };
  }

  return {
    reference: {
      ...reference,
      snippet:
        reference.snippet.trim() === ''
          ? makeSnippet(lines, reference.startLine)
          : reference.snippet,
      verified: true,
    },
    conflict: false,
  };
}
