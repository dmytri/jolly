#!/usr/bin/env bun
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { storeCommands } from './commands/store.js';
import { appCommands } from './commands/app.js';
import { agentCommands } from './commands/agent.js';
import { configCommands } from './commands/config.js';

yargs(hideBin(process.argv))
  .command(storeCommands)
  .command(appCommands)
  .command(agentCommands)
  .command(configCommands)
  .demandCommand(1, 'You must provide a command')
  .strict()
  .parse();
