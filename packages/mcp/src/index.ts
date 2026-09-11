/**
 * @fleet/mcp — MCP 暴露层（M12）。
 *
 * - types       ToolDefinition / ToolResult / 协议常量
 * - server      McpServer（stdio JSON-RPC 最小协议循环）
 * - repo-tools  Repository Intelligence 七工具装配
 * - fleet-tools Fleet 五工具装配
 */

export * from './types.js';
export * from './server.js';
export * from './repo-tools.js';
export * from './fleet-tools.js';
