#!/usr/bin/env node
import { createStore } from '../commands/store.js';

async function main() {
  const args = process.argv.slice(2);
  const projectName = args[0];

  if (projectName) {
    console.log(`Bootstrapping Saleor project: ${projectName}...`);
    await createStore(projectName, 'us-east-1');
    return;
  }

  console.log('Saleor Store Bootstrapper');
  console.log('------------------------\n');
  console.log('Usage: npm create @saleor/jolly <project-name>');
  console.log('Or: jolly store create --name <name>');
  console.log('\nFor app scaffolding: jolly app create --name <name> --type <type>');
}

main().catch((err) => {
  console.error(`Bootstrap failed: ${err}`);
  process.exit(1);
});
