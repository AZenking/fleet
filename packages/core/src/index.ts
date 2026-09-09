/**
 * @fleet/core — Agent Fleet 共享基础能力（M0，US3 验收：单一入口导出）。
 *
 * 模块一览（M1+ 开发者从这里直接引用，零底座代码）：
 * - config       配置加载与 Zod Schema 校验（configs/fleet.yaml）
 * - errors       FleetError 统一错误模型（逐字段 issues）
 * - events       FleetEvent 结构化事件 schema 与序列化（持久化在 M11）
 * - fs           文件系统抽象（真实 / 内存双实现，测试不触碰磁盘）
 * - git          Git 仓库检测（向上查找 .git）
 * - ids          ID 生成（语义前缀 + randomUUID）
 * - logging      Logger 接口与 console / stderr / silent 实现
 * - probe        命令存在性探测与 Node 版本满足性检查
 * - diagnostics  DiagnosticReport（fleet doctor 输出实体）
 */

export const CORE_READY = true;

export * from './config/schema.js';
export * from './config/loader.js';
export * from './diagnostics/report.js';
export * from './errors/index.js';
export * from './events/index.js';
export * from './fs/index.js';
export * from './git/detect.js';
export * from './ids/index.js';
export * from './logging/index.js';
export * from './probe/exists.js';
export * from './probe/node-version.js';
