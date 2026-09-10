import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import type { FileSystemPort } from '@fleet/core';

import type { WikiPage } from '../types.js';
import { FENCE_END, FENCE_START, serializeWikiPage } from '../format.js';

/**
 * 确定性事实提取（research.md D5，FR-011：无 LLM）。
 *
 * 全部路径引用来自真实扫描结果——生成的页面天然满足锚定校验
 * （FR-004）。深度叙述由人工/外部 LLM 写在围栏外（FR-009 保护）。
 */

/** 单页生成规格：目标路径 + 元数据语义 + 围栏内内容 */
export interface PageSpec {
  /** 相对 wiki 根，如 domains/core.md */
  path: string;
  section: WikiPage['section'];
  title: string;
  scope: string[];
  content: string;
}

export interface RepoScan {
  specs: PageSpec[];
  isMonorepo: boolean;
  /** 文件数超上限（research.md D11），已在 overview 标注 */
  truncated: boolean;
}

/** 仓库扫描文件数上限 */
const MAX_FILES = 10_000;

export interface InitOutcome {
  created: string[];
}

const SECTION_READMES: Array<{ dir: string; title: string; purpose: string }> =
  [
    {
      dir: 'architecture',
      title: 'architecture 分区',
      purpose:
        '仓库架构总览（overview 由 build 生成，人工分析写在围栏外或本页）。',
    },
    {
      dir: 'domains',
      title: 'domains 分区',
      purpose:
        '领域/模块页面：monorepo 每包一页（build 生成），业务域说明可手工新增。',
    },
    {
      dir: 'infrastructure',
      title: 'infrastructure 分区',
      purpose: '构建、测试与质量门（tooling 由 build 生成）。',
    },
    {
      dir: 'decisions',
      title: 'decisions 分区',
      purpose: '架构决策记录（ADR）。建议每决策一页：背景 / 决策 / 后果。',
    },
  ];

/**
 * fleet wiki init：幂等建立骨架（FR-001）——index + 四分区 + glossary。
 * 只补缺失文件；已有内容与人工页面原样保留。
 */
export function initWiki(
  fs: FileSystemPort,
  repoRoot: string,
  wikiRoot: string,
  now: () => string,
): InitOutcome {
  const created: string[] = [];
  const ensure = (relative: string, raw: string): void => {
    const absolute = path.join(wikiRoot, relative);
    if (fs.readFileOptional(absolute) === undefined) {
      fs.writeFile(absolute, raw);
      created.push(relative);
    }
  };

  ensure(
    'index.md',
    pageRaw({
      path: 'index.md',
      section: 'index',
      title: 'Repository Wiki',
      scope: ['.'],
      generatedContent: [
        '# Repository Wiki',
        '',
        '（骨架已建立，导航尚未生成。）',
        '',
        '运行 `fleet wiki build` 生成页面清单与导航。',
      ].join('\n'),
      generatedFrom: undefined,
      now,
    }),
  );

  for (const readme of SECTION_READMES) {
    ensure(
      `${readme.dir}/README.md`,
      manualPageRaw(
        readme.title,
        ['.'],
        [`# ${readme.title}`, '', readme.purpose, ''].join('\n'),
      ),
    );
  }

  ensure(
    'decisions/DECISION-TEMPLATE.md',
    pageRaw({
      path: 'decisions/DECISION-TEMPLATE.md',
      section: 'decisions',
      title: '决策模板',
      scope: ['.'],
      generatedContent: [
        '# ADR-NNN：<决策标题>',
        '',
        '- 状态：提议 / 已接受 / 已取代',
        '- 日期：YYYY-MM-DD',
        '',
        '## 背景',
        '',
        '## 决策',
        '',
        '## 后果',
      ].join('\n'),
      generatedFrom: undefined,
      now,
    }),
  );

  ensure(
    'glossary.md',
    pageRaw({
      path: 'glossary.md',
      section: 'glossary',
      title: '术语表',
      scope: ['.'],
      generatedContent: [
        '# 术语表',
        '',
        '| 术语 | 含义 |',
        '|---|---|',
        '| （待补充） | 术语定义请补充在围栏外，或直接修改本表 |',
      ].join('\n'),
      generatedFrom: undefined,
      now,
    }),
  );

  return { created };
}

interface RawPageInput {
  path: string;
  section: WikiPage['section'];
  title: string;
  scope: string[];
  generatedContent: string;
  generatedFrom: string | undefined;
  now: () => string;
}

function pageRaw(input: RawPageInput): string {
  const page: WikiPage = {
    path: input.path,
    section: input.section,
    metadata: {
      title: input.title,
      ...(input.generatedFrom !== undefined
        ? { generated_from: input.generatedFrom }
        : {}),
      updated_at: input.now(),
      scope: input.scope,
    },
    generatedContent: input.generatedContent,
    manualBefore: '\n',
    manualAfter: '\n',
    origin: 'generated',
  };
  return serializeWikiPage(page);
}

function manualPageRaw(title: string, scope: string[], body: string): string {
  const page: WikiPage = {
    path: 'placeholder.md',
    section: 'domains',
    metadata: {
      title,
      updated_at: new Date().toISOString(),
      scope,
    },
    manualBefore: `\n${body}`,
    manualAfter: '',
    origin: 'manual',
  };
  return serializeWikiPage(page);
}

interface PackageFacts {
  /** 仓库相对目录，如 packages/core */
  dir: string;
  name: string;
  shortName: string;
  description: string;
  internalDeps: string[];
  externalDeps: string[];
  scripts: string[];
  entryComment: string[];
  srcTree: string[];
}

interface WalkBudget {
  count: number;
  truncated: boolean;
}

function countFile(budget: WalkBudget): boolean {
  budget.count += 1;
  if (budget.count > MAX_FILES) {
    budget.truncated = true;
    return false;
  }
  return true;
}

/** 仓库事实扫描 → 页面规格全集 */
export function scanRepo(fs: FileSystemPort, repoRoot: string): RepoScan {
  const budget: WalkBudget = { count: 0, truncated: false };
  const rootPkg = readPackageJson(fs, path.join(repoRoot, 'package.json'));
  const workspaceDirs = detectWorkspaceDirs(fs, repoRoot, rootPkg);
  const isMonorepo = workspaceDirs.length > 0;
  const specs: PageSpec[] = [];

  if (isMonorepo) {
    const packages: PackageFacts[] = [];
    for (const base of workspaceDirs) {
      const baseAbs = path.join(repoRoot, base);
      let entries: string[];
      try {
        entries = fs.listDir(baseAbs);
      } catch {
        continue;
      }
      for (const entry of entries.sort()) {
        const dir = `${base}/${entry}`;
        const pkg = readPackageJson(
          fs,
          path.join(repoRoot, dir, 'package.json'),
        );
        if (pkg === undefined) {
          continue;
        }
        packages.push(collectPackageFacts(fs, repoRoot, dir, pkg, budget));
      }
    }
    // 二次解析内部/外部依赖（全部包名收集完成后才能区分）
    const names = new Set(packages.map((p) => p.name));
    for (const pkg of packages) {
      const deps = Object.keys(
        readPackageJson(fs, path.join(repoRoot, pkg.dir, 'package.json'))
          ?.dependencies ?? {},
      );
      for (const dep of deps) {
        (names.has(dep) ? pkg.internalDeps : pkg.externalDeps).push(dep);
      }
    }

    specs.push(overviewSpec(repoRoot, workspaceDirs, packages, budget));
    for (const pkg of packages) {
      specs.push(packageSpec(pkg));
    }
    specs.push(toolingSpec(fs, repoRoot, rootPkg));
  } else {
    specs.push(...plainRepoSpecs(fs, repoRoot, budget));
    const rootPkgJson = rootPkg;
    if (rootPkgJson !== undefined) {
      specs.push(toolingSpec(fs, repoRoot, rootPkgJson));
    }
  }

  return { specs, isMonorepo, truncated: budget.truncated };
}

function detectWorkspaceDirs(
  fs: FileSystemPort,
  repoRoot: string,
  rootPkg: Record<string, unknown> | undefined,
): string[] {
  const dirs = new Set<string>();
  const workspaceYaml = fs.readFileOptional(
    path.join(repoRoot, 'pnpm-workspace.yaml'),
  );
  if (workspaceYaml !== undefined) {
    try {
      const parsed = parseYaml(workspaceYaml) as { packages?: unknown } | null;
      if (Array.isArray(parsed?.packages)) {
        for (const glob of parsed.packages) {
          if (typeof glob === 'string' && glob.includes('/')) {
            dirs.add(glob.split('/')[0] ?? '');
          }
        }
      }
    } catch {
      // 解析失败退回默认 packages/
    }
    if (dirs.size === 0) {
      dirs.add('packages');
    }
  }
  const workspaces = rootPkg?.['workspaces'];
  if (workspaces !== null && typeof workspaces === 'object') {
    const workspacesPackages = (workspaces as { packages?: unknown }).packages;
    if (Array.isArray(workspacesPackages)) {
      for (const glob of workspacesPackages) {
        if (typeof glob === 'string' && glob.includes('/')) {
          dirs.add(glob.split('/')[0] ?? '');
        }
      }
    }
  }
  if (fs.exists(path.join(repoRoot, 'apps'))) {
    dirs.add('apps');
  }
  return [...dirs].filter(Boolean).sort();
}

function readPackageJson(
  fs: FileSystemPort,
  absolute: string,
): Record<string, unknown> | undefined {
  const raw = fs.readFileOptional(absolute);
  if (raw === undefined) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function collectPackageFacts(
  fs: FileSystemPort,
  repoRoot: string,
  dir: string,
  pkg: Record<string, unknown>,
  budget: WalkBudget,
): PackageFacts {
  const name = typeof pkg['name'] === 'string' ? pkg['name'] : dir;
  const facts: PackageFacts = {
    dir,
    name,
    shortName: name.replace(/^@[^/]+\//, ''),
    description:
      typeof pkg['description'] === 'string' ? pkg['description'] : '',
    internalDeps: [],
    externalDeps: [],
    scripts:
      pkg['scripts'] !== null && typeof pkg['scripts'] === 'object'
        ? Object.keys(pkg['scripts'] as Record<string, unknown>)
        : [],
    entryComment: readEntryComment(fs, path.join(repoRoot, dir, 'src')),
    srcTree: readSrcTree(fs, path.join(repoRoot, dir, 'src'), budget),
  };
  return facts;
}

/** 入口文件首块 JSDoc 注释（本仓库惯例：index.ts 头部即模块说明） */
function readEntryComment(fs: FileSystemPort, srcDir: string): string[] {
  for (const entry of ['index.ts', 'index.js']) {
    const raw = fs.readFileOptional(path.join(srcDir, entry));
    if (raw === undefined) {
      continue;
    }
    const match = /^\/\*\*([\s\S]*?)\*\//.exec(raw.trimStart());
    if (match === null) {
      continue;
    }
    return (
      match[1]
        ?.split('\n')
        .map((line) => line.replace(/^\s*\*? ?/, '').trimEnd())
        .filter((line) => line.trim() !== '') ?? []
    );
  }
  return [];
}

/** src/ 目录一瞥（一级文件全列、二级目录计文件数，上限 20 行） */
function readSrcTree(
  fs: FileSystemPort,
  srcDir: string,
  budget: WalkBudget,
): string[] {
  let entries: string[];
  try {
    entries = fs.listDir(srcDir).sort();
  } catch {
    return [];
  }
  const lines: string[] = [];
  for (const entry of entries) {
    if (lines.length >= 20) {
      lines.push(`……（共 ${entries.length} 项，已截断）`);
      break;
    }
    const abs = path.join(srcDir, entry);
    if (isDirectory(fs, abs)) {
      lines.push(`- ${entry}/（${countDirFiles(fs, abs, budget)} 文件）`);
    } else if (countFile(budget)) {
      lines.push(`- ${entry}`);
    }
  }
  return lines;
}

function countDirFiles(
  fs: FileSystemPort,
  dir: string,
  budget: WalkBudget,
): number {
  let total = 0;
  const visit = (current: string): void => {
    let entries: string[];
    try {
      entries = fs.listDir(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(current, entry);
      if (isDirectory(fs, abs)) {
        visit(abs);
      } else if (countFile(budget)) {
        total += 1;
      }
    }
  };
  visit(dir);
  return total;
}

function isDirectory(fs: FileSystemPort, absolute: string): boolean {
  try {
    fs.readFile(absolute);
    return false;
  } catch {
    return fs.exists(absolute) || listDirWorks(fs, absolute);
  }
}

function listDirWorks(fs: FileSystemPort, absolute: string): boolean {
  try {
    fs.listDir(absolute);
    return true;
  } catch {
    return false;
  }
}

function overviewSpec(
  _repoRoot: string,
  workspaceDirs: string[],
  packages: PackageFacts[],
  budget: WalkBudget,
): PageSpec {
  const lines: string[] = [
    '# 仓库总览',
    '',
    `- 布局：workspace monorepo（${workspaceDirs.map((dir) => `\`${dir}/\``).join('、')}）`,
    `- 包数量：${packages.length}`,
    '',
    '## 内部依赖（包 → 依赖的内部包）',
    '',
  ];
  if (packages.length === 0) {
    lines.push('- （未发现带 package.json 的包）');
  }
  for (const pkg of packages) {
    lines.push(
      `- \`${pkg.dir}\`（${pkg.name}）→ ${
        pkg.internalDeps.length > 0
          ? pkg.internalDeps.map((dep) => `\`${dep}\``).join('、')
          : '（无内部依赖）'
      }`,
    );
  }
  if (budget.truncated) {
    lines.push('', `> ⚠ 文件数超过 ${MAX_FILES}，扫描已截断，条目可能不完整。`);
  }
  lines.push('', '（本页由 `fleet wiki build` 生成；人工分析请写在围栏外。）');
  return {
    path: 'architecture/overview.md',
    section: 'architecture',
    title: '仓库总览',
    scope: ['.'],
    content: lines.join('\n'),
  };
}

function packageSpec(pkg: PackageFacts): PageSpec {
  const lines: string[] = [`# ${pkg.name}`, ''];
  lines.push(`- 位置：\`${pkg.dir}\``);
  if (pkg.description !== '') {
    lines.push(`- 描述：${pkg.description}`);
  }
  lines.push(
    `- 内部依赖：${pkg.internalDeps.length > 0 ? pkg.internalDeps.map((dep) => `\`${dep}\``).join('、') : '（无）'}`,
  );
  lines.push(
    `- 外部依赖：${pkg.externalDeps.length > 0 ? pkg.externalDeps.map((dep) => `\`${dep}\``).join('、') : '（无）'}`,
  );
  if (pkg.scripts.length > 0) {
    lines.push(`- 脚本：${pkg.scripts.join(' / ')}`);
  }
  if (pkg.entryComment.length > 0) {
    lines.push('', `## 模块说明（\`${pkg.dir}/src/index.ts\`）`, '');
    for (const line of pkg.entryComment) {
      lines.push(`- ${line.replace(/^- /, '')}`);
    }
  }
  if (pkg.srcTree.length > 0) {
    lines.push('', `## 目录结构（\`${pkg.dir}/src\`）`, '');
    lines.push(...pkg.srcTree);
  }
  lines.push('', '（本页由 `fleet wiki build` 生成；人工补充请写在围栏外。）');
  return {
    path: `domains/${pkg.shortName}.md`,
    section: 'domains',
    title: pkg.name,
    scope: [pkg.dir],
    content: lines.join('\n'),
  };
}

const TOOLING_CONFIG_CANDIDATES: Array<{ file: string; label: string }> = [
  { file: 'pnpm-workspace.yaml', label: 'pnpm workspace 定义' },
  { file: 'tsconfig.base.json', label: 'TypeScript 基线' },
  { file: 'eslint.config.js', label: 'ESLint' },
  { file: 'eslint.config.mjs', label: 'ESLint' },
  { file: 'eslint.config.cjs', label: 'ESLint' },
  { file: 'vitest.config.ts', label: 'Vitest' },
  { file: 'vitest.config.js', label: 'Vitest' },
  { file: '.gitignore', label: 'Git 忽略清单' },
];

function toolingSpec(
  fs: FileSystemPort,
  repoRoot: string,
  rootPkg: Record<string, unknown> | undefined,
): PageSpec {
  const lines: string[] = ['# 工程设施', ''];
  const configs: string[] = [];
  const seen = new Set<string>();
  for (const candidate of TOOLING_CONFIG_CANDIDATES) {
    const absolute = path.join(repoRoot, candidate.file);
    let exists: boolean;
    try {
      fs.readFile(absolute);
      exists = true;
    } catch {
      exists = false;
    }
    if (exists && !seen.has(candidate.label)) {
      seen.add(candidate.label);
      configs.push(`- ${candidate.label}：\`${candidate.file}\``);
    }
  }
  lines.push(...configs);
  if (rootPkg !== undefined) {
    const scripts =
      rootPkg['scripts'] !== null && typeof rootPkg['scripts'] === 'object'
        ? Object.entries(rootPkg['scripts'] as Record<string, unknown>)
        : [];
    if (scripts.length > 0) {
      lines.push('', `## 根脚本（\`package.json\`）`, '');
      for (const [name, value] of scripts) {
        lines.push(`- \`${name}\` — ${String(value)}`);
      }
    }
    if (typeof rootPkg['engines'] === 'object' && rootPkg['engines'] !== null) {
      const engines = Object.entries(
        rootPkg['engines'] as Record<string, unknown>,
      )
        .map(([key, value]) => `${key} ${String(value)}`)
        .join('、');
      lines.push('', `- 引擎要求：${engines}`);
    }
  }
  lines.push('', '（本页由 `fleet wiki build` 生成。）');
  const scope = TOOLING_CONFIG_CANDIDATES.map((c) => c.file).filter((file) =>
    fs.exists(path.join(repoRoot, file)),
  );
  return {
    path: 'infrastructure/tooling.md',
    section: 'infrastructure',
    title: '工程设施',
    scope: ['package.json', ...scope],
    content: lines.join('\n'),
  };
}

/** 非 monorepo 兜底：src/ 结构扫描，同样产出真实条目（research.md D5） */
function plainRepoSpecs(
  fs: FileSystemPort,
  repoRoot: string,
  budget: WalkBudget,
): PageSpec[] {
  const specs: PageSpec[] = [];
  const srcDir = path.join(repoRoot, 'src');
  let entries: string[];
  try {
    entries = fs.listDir(srcDir).sort();
  } catch {
    entries = [];
  }
  const files = entries.filter(
    (entry) => !isDirectory(fs, path.join(srcDir, entry)),
  );
  const dirs = entries.filter((entry) =>
    isDirectory(fs, path.join(srcDir, entry)),
  );

  const overviewLines: string[] = [
    '# 仓库总览',
    '',
    '- 布局：单项目（未检测到 workspace）',
  ];
  if (entries.length > 0) {
    overviewLines.push('', `## src/ 一级结构（\`src\`）`, '');
    for (const dir of dirs) {
      overviewLines.push(
        `- ${dir}/（${countDirFiles(fs, path.join(srcDir, dir), budget)} 文件）`,
      );
    }
    for (const file of files) {
      if (countFile(budget)) {
        overviewLines.push(`- ${file}`);
      }
    }
  } else {
    overviewLines.push('- 未发现 src/ 目录（顶层结构待人工补充在围栏外）');
  }
  if (budget.truncated) {
    overviewLines.push('', `> ⚠ 文件数超过 ${MAX_FILES}，扫描已截断。`);
  }
  overviewLines.push('', '（本页由 `fleet wiki build` 生成。）');
  specs.push({
    path: 'architecture/overview.md',
    section: 'architecture',
    title: '仓库总览',
    scope: ['.'],
    content: overviewLines.join('\n'),
  });

  for (const dir of dirs) {
    const subLines = [`## src/${dir}`, ''];
    const subFiles = fs
      .listDir(path.join(srcDir, dir))
      .sort()
      .filter((entry) => !isDirectory(fs, path.join(srcDir, dir, entry)));
    for (const file of subFiles) {
      if (countFile(budget)) {
        subLines.push(`- \`${dir}/${file}\``);
      }
    }
    subLines.push('', '（本页由 `fleet wiki build` 生成。）');
    specs.push({
      path: `domains/${dir}.md`,
      section: 'domains',
      title: dir,
      scope: [`src/${dir}`],
      content: subLines.join('\n'),
    });
  }
  return specs;
}

export { FENCE_START, FENCE_END };
