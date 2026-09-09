/**
 * 问题解析：确定性规则（research.md D3，FR-011 无 LLM）。
 * 符号样式 → 结构路径；路径样式 → 范围限定；其余 → 关键词。
 */

export interface InvestigationPlan {
  symbols: string[];
  keywords: string[];
  pathHints: string[];
}

const STOPWORDS = new Set([
  '在哪里',
  '哪里',
  '怎么',
  '如何',
  '是',
  '什么',
  '哪些',
  '被',
  '的',
  '了',
  '和',
  '与',
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'where',
  'how',
  'what',
  'which',
  'in',
  'of',
  'on',
  'to',
  'for',
  'by',
  'with',
  'and',
  'or',
  'does',
  'do',
]);

function isSymbolLike(token: string): boolean {
  return (
    (/^[A-Z][a-zA-Z0-9]*$/.test(token) && /[a-z]/.test(token)) || // PascalCase
    /^[a-z][a-z0-9]*[A-Z][a-zA-Z0-9]*$/.test(token) || // camelCase
    /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(token) || // snake_case
    /^[A-Z][A-Z0-9_]{2,}$/.test(token) // CONST
  );
}

/** CJK 停用短语：从纯中文 token 的首尾反复剥离（"在哪里被抛出"→"抛出"） */
const CJK_STOPWORD_EDGES = [
  '在哪里',
  '哪里',
  '怎么',
  '如何',
  '什么',
  '哪些',
  '是不是',
  '被',
  '的',
  '了',
  '是',
  '和',
  '与',
  '在',
  '看下',
  '查看',
  '找一下',
];

function trimStopwordEdges(token: string): string {
  let result = token;
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of CJK_STOPWORD_EDGES) {
      if (result.startsWith(edge) && result.length > edge.length) {
        result = result.slice(edge.length);
        changed = true;
      } else if (result.endsWith(edge) && result.length > edge.length) {
        result = result.slice(0, -edge.length);
        changed = true;
      }
    }
  }
  return result;
}

function isPathLike(token: string): boolean {
  return token.includes('/') || /\.[A-Za-z]{1,5}$/.test(token);
}

export function planQuestion(question: string): InvestigationPlan {
  const tokens = question
    // 注意：不在 '.' 上切分（保住 src/a.ts 这类路径 token）
    .split(/[\s,;:?()[\]{}"'`、，；：！？（）「」【】]+/)
    .map((token) => token.replace(/^[.,;:!?]+|[.,;:!?]+$/g, '').trim())
    .filter(Boolean);

  const symbols: string[] = [];
  const keywords: string[] = [];
  const pathHints: string[] = [];

  for (const token of tokens) {
    if (isPathLike(token)) {
      pathHints.push(token);
    } else if (isSymbolLike(token)) {
      symbols.push(token);
    } else {
      const keyword = /[\u4e00-\u9fff]/.test(token)
        ? trimStopwordEdges(token)
        : token;
      if (
        keyword !== '' &&
        !STOPWORDS.has(keyword) &&
        !STOPWORDS.has(keyword.toLowerCase())
      ) {
        keywords.push(keyword);
      }
    }
  }

  return {
    symbols: [...new Set(symbols)].slice(0, 3),
    keywords: [...new Set(keywords)],
    pathHints: [...new Set(pathHints)],
  };
}
