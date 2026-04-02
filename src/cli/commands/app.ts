import type { CommandModule } from 'yargs';
import { createApp } from '../../commands/app.js';

type AppType = 'dashboard-extension' | 'payment' | 'webhook';
type PaymentProvider = 'dummy' | 'stripe';

export const appCommands: CommandModule = {
  command: 'app <action>',
  describe: 'Scaffold Saleor apps',
  builder: (yargs) =>
    yargs
      .command({
        command: 'create',
        describe: 'Create a new Saleor app',
        builder: (yargs) =>
          yargs
            .option('name', {
              alias: 'n',
              type: 'string',
              description: 'App name',
              demandOption: true,
            })
            .option('type', {
              alias: 't',
              type: 'string',
              choices: ['dashboard-extension', 'payment', 'webhook'],
              description: 'App type',
              demandOption: true,
            })
            .option('provider', {
              alias: 'p',
              type: 'string',
              choices: ['dummy', 'stripe'],
              description: 'Payment provider (for payment apps)',
              default: 'dummy',
            })
            .option('environment', {
              alias: 'e',
              type: 'string',
              description: 'Environment ID to register app with',
            }),
        handler: async (argv) => {
          await createApp(
            argv.name,
            argv.type as AppType,
            argv.environment,
            argv.provider as PaymentProvider
          );
        },
      }),
};
