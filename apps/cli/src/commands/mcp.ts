import type { Command } from 'commander';

import { McpServer, buildFleetTools, buildRepoTools } from '@fleet/mcp';

import pkg from '../../package.json' with { type: 'json' };

/**
 * fleet mcp（M12，contracts/mcp-api.md §4）：两个 MCP 服务入口——
 * stdio JSON-RPC（Codex Desktop 等标准客户端接入）。协议不过
 * stderr（留给运行时日志）。
 */
export function registerMcpCommand(program: Command): void {
  program
    .command('mcp <server>')
    .description(
      '启动 MCP 服务（repo = Repository Intelligence 七工具 / fleet = Fleet 五工具）',
    )
    .option('--repo <root>', '目标仓库根（缺省 cwd）')
    .action(async (server: string, options: { repo?: string }) => {
      const name =
        server === 'repo'
          ? 'fleet-repo'
          : server === 'fleet'
            ? 'fleet'
            : undefined;
      if (name === undefined) {
        console.error(`✗ 未知服务：${server}（repo | fleet）`);
        process.exitCode = 2;
        return;
      }
      if (options.repo !== undefined) {
        process.chdir(options.repo);
      }
      const mcp = new McpServer({
        name,
        version: pkg.version,
        tools:
          server === 'repo'
            ? buildRepoTools()
            : buildFleetTools({ repoRoot: process.cwd() }),
      });
      await mcp.start();
    });
}
