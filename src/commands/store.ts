import { SaleorCloudClient } from '../api/client.js';
import { requireToken } from '../api/auth.js';
import { spinner, success, error, info } from '../tui/components.js';

export async function createStore(name: string, region: string): Promise<void> {
  const token = requireToken();
  const client = new SaleorCloudClient(token);

  info(`Creating store: ${name} in ${region}...`);

  try {
    const result = await client.createStore(name, region);
    success(`Store created successfully!`);
    info(`Store ID: ${result.store.id}`);
    info(`Dashboard: https://cloud.saleor.io/stores/${result.store.id}`);
  } catch (err) {
    error(`Failed to create store: ${err}`);
    process.exit(1);
  }
}

export async function listStores(): Promise<void> {
  const token = requireToken();
  const client = new SaleorCloudClient(token);

  info('Fetching stores...');

  try {
    const result = await client.getStores();

    if (result.stores.length === 0) {
      info('No stores found. Create one with: jolly store create --name <name>');
      return;
    }

    success(`Found ${result.stores.length} store(s):\n`);
    for (const store of result.stores) {
      console.log(`  ${store.name} (${store.id})`);
      console.log(`    Region: ${store.region}`);
      console.log(`    Created: ${new Date(store.created_at).toLocaleDateString()}`);
      console.log();
    }
  } catch (err) {
    error(`Failed to list stores: ${err}`);
    process.exit(1);
  }
}

export async function createEnvironment(storeId: string, name: string): Promise<void> {
  const token = requireToken();
  const client = new SaleorCloudClient(token);

  info(`Creating environment: ${name} for store ${storeId}...`);

  try {
    const result = await client.createEnvironment(storeId, name);
    success(`Environment created successfully!`);
    info(`Environment ID: ${result.environment.id}`);
    info(`API URL will be available at: https://${result.environment.id}.saleor.cloud`);
  } catch (err) {
    error(`Failed to create environment: ${err}`);
    process.exit(1);
  }
}
