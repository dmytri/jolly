#!/usr/bin/env node
import { setupAgent, installSkillsCommand } from '../agents/setup.js';

async function main() {
  const args = process.argv.slice(2);
  const action = args[0] || 'setup';

  if (action === 'setup' || action === 'install') {
    console.log('Saleor Agent Setup');
    console.log('-------------------\n');
    await setupAgent('.');
    console.log('\nAgent configured successfully!');
    console.log('Restart your AI agent to enable Saleor capabilities.');
  } else if (action === 'skills') {
    await installSkillsCommand('.');
  } else {
    console.error(`Unknown action: ${action}`);
    console.log('Usage: jolly-agent [setup|skills]');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Agent setup failed: ${err}`);
  process.exit(1);
});
