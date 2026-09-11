import { Command } from 'commander';
import pkg from '../package.json' with { type: 'json' };
import { registerDoctorCommand } from './commands/doctor.js';
import { registerMissionCommand } from './commands/mission.js';
import { registerRepoCommand } from './commands/repo.js';
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
registerWikiCommand(program);

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
