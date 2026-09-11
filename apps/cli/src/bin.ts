import { Command } from 'commander';
import pkg from '../package.json' with { type: 'json' };
import { registerDoctorCommand } from './commands/doctor.js';
import { registerMissionCommand } from './commands/mission.js';
import { registerMcpCommand } from './commands/mcp.js';
import { registerObserveCommands } from './commands/observe.js';
import { registerRepoCommand } from './commands/repo.js';
import { registerRunCommand } from './commands/run.js';
import { registerVersionCommand } from './commands/version.js';
import { registerWikiCommand } from './commands/wiki.js';

const program = new Command();

program
  .name('fleet')
  .description('Agent Fleet 命令行工具')
  .version(pkg.version);

registerVersionCommand(program);
registerDoctorCommand(program);
registerMissionCommand(program);
registerRepoCommand(program);
registerRunCommand(program);
registerWikiCommand(program);
registerObserveCommands(program);
registerMcpCommand(program);

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
