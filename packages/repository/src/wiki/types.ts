import { z } from 'zod';

/**
 * Wiki 域实体（data-model.md §1–§6）。
 *
 * 磁盘格式（front matter / 围栏 / index）见 contracts/wiki-format.md；
 * origin 由围栏结构推导（research.md D2），不落盘。
 */

export const WIKI_DIR = '.fleet/wiki';
export const WIKI_BACKUP_DIR = '.fleet/wiki/.backup';

/** 分区固定顺序（index 导航与结构校验共用） */
export const WIKI_SECTIONS = [
  'architecture',
  'domains',
  'infrastructure',
  'decisions',
] as const;
export type WikiSectionDir = (typeof WIKI_SECTIONS)[number];

export const pageOriginSchema = z.enum(['generated', 'manual', 'mixed']);
export type PageOrigin = z.infer<typeof pageOriginSchema>;

export const wikiMetadataSchema = z.strictObject({
  title: z.string().min(1),
  /** 7–40 位 hex git sha；缺失 = 非 git 仓库，不可锚定（FR-002） */
  generated_from: z
    .string()
    .regex(/^[0-9a-f]{7,40}$/)
    .optional(),
  updated_at: z.string().min(1),
  /** 仓库相对路径前缀（`.` = 全仓库）；尾部 `/` 归一 */
  scope: z.array(z.string().min(1)).min(1),
});
export type WikiMetadata = z.infer<typeof wikiMetadataSchema>;

/**
 * 页面内存实体。生成区为单一围栏对（generator 契约）；围栏外人工
 * 内容按前后两段原样保留（FR-009）。
 */
export const wikiPageSchema = z.strictObject({
  /** 相对 wiki 根，如 domains/core.md */
  path: z.string().min(1),
  section: z.enum([
    'index',
    'architecture',
    'domains',
    'infrastructure',
    'decisions',
    'glossary',
  ]),
  metadata: wikiMetadataSchema,
  generatedContent: z.string().optional(),
  manualBefore: z.string(),
  manualAfter: z.string(),
  origin: pageOriginSchema,
});
export type WikiPage = z.infer<typeof wikiPageSchema>;

export const validationErrorCodeSchema = z.enum([
  'missing_index',
  'missing_section',
  'bad_frontmatter',
  'bad_metadata',
  'unpaired_fence',
  'dead_reference',
  'dead_link',
  'index_out_of_sync',
]);
export type ValidationErrorCode = z.infer<typeof validationErrorCodeSchema>;

export const validationErrorSchema = z.strictObject({
  code: validationErrorCodeSchema,
  detail: z.string(),
  /** 全局性错误（如 missing_index）无页面归属 */
  pagePath: z.string().optional(),
});
export type ValidationError = z.infer<typeof validationErrorSchema>;

export const validationReportSchema = z.strictObject({
  ok: z.boolean(),
  errors: z.array(validationErrorSchema),
});
export type ValidationReport = z.infer<typeof validationReportSchema>;

export const pageFreshnessSchema = z.strictObject({
  path: z.string(),
  origin: pageOriginSchema,
  /** changed files ∩ scope ≠ ∅（SC-004 纯集合运算） */
  stale: z.boolean(),
  /** 命中的 scope 元素 */
  matchedScope: z.array(z.string()),
});
export type PageFreshness = z.infer<typeof pageFreshnessSchema>;

export const wikiStateSchema = z.enum(['fresh', 'stale', 'unknown']);
export type WikiState = z.infer<typeof wikiStateSchema>;

export const wikiStatusSchema = z.strictObject({
  exists: z.boolean(),
  state: wikiStateSchema,
  headSha: z.string().optional(),
  /** index 页的 generated_from 作为整体锚点 */
  generatedFrom: z.string().optional(),
  aheadCommits: z.number().int().nonnegative().optional(),
  changedFiles: z.array(z.string()),
  pages: z.array(pageFreshnessSchema),
  /** 受影响页面占比 > 70%（research.md D4） */
  fullRebuildRecommended: z.boolean(),
});
export type WikiStatus = z.infer<typeof wikiStatusSchema>;

export const wikiWriteResultSchema = z.strictObject({
  pagesWritten: z.array(z.string()),
  pagesUnchanged: z.array(z.string()),
  /** update 跳过的 manual 页（附人工更新提示，CLI 渲染） */
  pagesSkipped: z.array(z.string()),
  validation: validationReportSchema,
  /** mixed 页重写前的备份路径（.fleet/wiki/.backup/，滚动一代） */
  backups: z.array(z.string()),
  durationMs: z.number().int().nonnegative(),
  /** 非失败性说明（如 update 在 unknown 锚点下的提示） */
  note: z.string().optional(),
});
export type BuildResult = z.infer<typeof wikiWriteResultSchema>;
export type UpdateResult = BuildResult;

export const scoreBreakdownSchema = z.strictObject({
  title: z.number().int().nonnegative(),
  heading: z.number().int().nonnegative(),
  body: z.number().int().nonnegative(),
});
export type ScoreBreakdown = z.infer<typeof scoreBreakdownSchema>;

export const wikiHitSchema = z.strictObject({
  pagePath: z.string(),
  section: z.string(),
  title: z.string(),
  snippet: z.string(),
  /** 标题×3 + 小节×2 + 正文行×1（research.md D6，同分按 path 字典序） */
  score: z.number().int().nonnegative(),
  scoreBreakdown: scoreBreakdownSchema,
});
export type WikiHit = z.infer<typeof wikiHitSchema>;

export const wikiQueryResultSchema = z.strictObject({
  question: z.string(),
  hits: z.array(wikiHitSchema),
  /** 空结果时的主题建议（index 页面标题全集） */
  suggestions: z.array(z.string()),
  engine: z.enum(['ripgrep', 'walk']),
  durationMs: z.number().int().nonnegative(),
});
export type WikiQueryResult = z.infer<typeof wikiQueryResultSchema>;
