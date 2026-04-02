import type { CommandModule } from 'yargs';
import { createStore, listStores, createEnvironment } from '../../commands/store.js';

export const storeCommands: CommandModule = {
  command: 'store <action>',
  describe: 'Manage Saleor Cloud stores',
  builder: (yargs) =>
    yargs
      .command({
        command: 'create',
        describe: 'Create a new Saleor Cloud store',
        builder: (yargs) =>
          yargs
            .option('name', {
              alias: 'n',
              type: 'string',
              description: 'Store name',
              demandOption: true,
            })
            .option('region', {
              alias: 'r',
              type: 'string',
              description: 'Region (e.g., us-east-1)',
              default: 'us-east-1',
            }),
        handler: async (argv) => {
          await createStore(argv.name, argv.region);
        },
      })
      .command({
        command: 'list',
        describe: 'List your Saleor Cloud stores',
        builder: (yargs) => yargs,
        handler: async () => {
          await listStores();
        },
      })
      .command({
        command: 'env <action>',
        describe: 'Manage store environments',
        builder: (yargs) =>
          yargs
            .command({
              command: 'create',
              describe: 'Create a new environment',
              builder: (yargs) =>
                yargs
                  .option('store', {
                    alias: 's',
                    type: 'string',
                    description: 'Store ID',
                    demandOption: true,
                  })
                  .option('name', {
                    alias: 'n',
                    type: 'string',
                    description: 'Environment name',
                    demandOption: true,
                  }),
              handler: async (argv) => {
                await createEnvironment(argv.store as string, argv.name as string);
              },
            }),
      }),
};
