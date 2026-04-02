import type { CommandModule } from 'yargs';
import { setupAgent, installSkillsCommand } from '../../agents/setup.js';

export const agentCommands: CommandModule = {
  command: 'agent <action>',
  describe: 'Configure AI agents for Saleor',
  builder: (yargs) =>
    yargs
      .command({
        command: 'setup',
        describe: 'Setup AI agent with Saleor skills and MCP',
        builder: (yargs) => yargs.option('path', {
          alias: 'p',
          type: 'string',
          description: 'Project path',
          default: '.',
        }),
        handler: async (argv) => {
          await setupAgent(argv.path as string);
        },
      })
      .command({
        command: 'skills',
        describe: 'Install Saleor agent skills',
        builder: (yargs) =>
          yargs.command({
            command: 'install',
            describe: 'Install Saleor skills',
            builder: (yargs) => yargs.option('path', {
              alias: 'p',
              type: 'string',
              description: 'Project path',
              default: '.',
            }),
            handler: async (argv) => {
              await installSkillsCommand(argv.path as string);
            },
          }),
      }),
};
