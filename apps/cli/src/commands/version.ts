import type { Command } from 'commander';

/**
 * fleet version — 打印 CLI 版本号（FR-009）。
 *
 * commander 的 --version 已内置；本命令提供显式 `fleet version`
 * 子命令形式，便于脚本调用与未来嵌入版本详情。
 */
export function registerVersionCommand(program: Command): void {
  program
    .command('version')
    .description('打印 fleet CLI 版本号')
    .action(() => {
      // 复用 program 上注册的版本号，保持单一真源
      const version = program.version() || '0.0.0';
      console.log(version);
    });
}
