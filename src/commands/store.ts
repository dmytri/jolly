import { SaleorCloudClient } from '../api/client.js';
import { requireToken } from '../api/auth.js';
import { success, error, info } from '../tui/components.js';

export async function createStore(name: string, region: string): Promise<void> {
  const token = requireToken();
  const client = new SaleorCloudClient(token);

  console.log(info(`Creating store: ${name} in ${region}...`));

  try {
    const result = await client.createStore(name, region);
    console.log(success(`Store created successfully!`));
    console.log(info(`Project slug: ${result.project.slug}`));
    console.log(info(`Dashboard: https://cloud.saleor.io/organizations/default/projects/${result.project.slug}`));
  } catch (err) {
    console.log(error(`Failed to create store: ${err}`));
    process.exit(1);
  }
}

export async function listStores(): Promise<void> {
  const token = requireToken();
  const client = new SaleorCloudClient(token);

  console.log(info('Fetching organizations...'));

  try {
    const { organizations } = await client.getOrganizations();

    if (organizations.length === 0) {
      console.log(info('No organizations found. Create one at https://cloud.saleor.io'));
      return;
    }

    console.log(success(`Found ${organizations.length} organization(s):\n`));
    for (const org of organizations) {
      console.log(`  ${org.name} (${org.slug})`);
      console.log(`    Email: ${org.owner_email}`);
      console.log(`    Created: ${new Date(org.created).toLocaleDateString()}`);
      console.log();
    }
  } catch (err) {
    console.log(error(`Failed to list stores: ${err}`));
    process.exit(1);
  }
}

export async function createEnvironment(organizationSlug: string, name: string): Promise<void> {
  const token = requireToken();
  const client = new SaleorCloudClient(token);

  console.log(info(`Creating environment: ${name} for organization ${organizationSlug}...`));

  try {
    const { environment } = await client.createEnvironment(organizationSlug, 'default', name, 'us-east-1');
    console.log(success(`Environment created successfully!`));
    console.log(info(`Environment key: ${environment.key}`));
    console.log(info(`Domain: ${environment.domain}`));
  } catch (err) {
    console.log(error(`Failed to create environment: ${err}`));
    process.exit(1);
  }
}
