import { SaleorCloudClient } from '../api/client.js';
import { requireToken } from '../api/auth.js';
import { success, error, info } from '../tui/components.js';

type AppType = 'dashboard-extension' | 'payment' | 'webhook';
type PaymentProvider = 'dummy' | 'stripe';

const APP_TEMPLATES = {
  'dashboard-extension': {
    repo: 'https://github.com/saleor/saleor-app-sdk',
    description: 'Dashboard Extension App',
  },
  payment: {
    repo: 'https://github.com/saleor/saleor-apps',
    description: 'Payment App',
  },
  webhook: {
    repo: 'https://github.com/saleor/saleor-webhook-template',
    description: 'Webhook Handler',
  },
};

const PAYMENT_APP_URLS = {
  dummy: 'https://dummy-payment.saleor.io',
  stripe: 'https://stripe-payment.saleor.io',
};

export async function createApp(
  name: string,
  type: AppType,
  environmentId?: string,
  provider?: PaymentProvider
): Promise<void> {
  info(`Creating ${type} app: ${name}`);

  if (type === 'payment') {
    const paymentProvider = provider || 'dummy';
    info(`Payment provider: ${paymentProvider}`);
    info(`Using hosted payment app: ${PAYMENT_APP_URLS[paymentProvider]}`);

    if (environmentId) {
      await registerHostedApp(environmentId, name, paymentProvider);
    } else {
      success(`\nPayment app "${name}" configured to use ${PAYMENT_APP_URLS[paymentProvider]}`);
      info(`\nTo complete setup:`);
      info(`1. Go to your dashboard at https://cloud.saleor.io`);
      info(`2. Navigate to Apps > Third party apps`);
      info(`3. Add the ${paymentProvider} payment app from ${PAYMENT_APP_URLS[paymentProvider]}`);
    }
    return;
  }

  const template = APP_TEMPLATES[type];
  info(`Cloning template from: ${template.repo}`);

  try {
    const { spawn } = await import('child_process');
    const child = spawn('git', ['clone', template.repo, name], {
      stdio: 'inherit',
    });

    child.on('close', (code) => {
      if (code === 0) {
        success(`\n${type} app "${name}" created successfully!`);
        info(`\nTo get started:`);
        info(`cd ${name}`);
        info(`npm install`);
        info(`npm run dev`);

        if (environmentId) {
          info(`\nRegistering app with environment ${environmentId}...`);
          registerLocalApp(environmentId, name, type);
        }
      } else {
        error(`Failed to clone template (exit code: ${code})`);
        process.exit(1);
      }
    });
  } catch (err) {
    error(`Failed to create app: ${err}`);
    process.exit(1);
  }
}

async function registerHostedApp(
  environmentId: string,
  name: string,
  provider: PaymentProvider
): Promise<void> {
  const token = requireToken();
  const client = new SaleorCloudClient(token);

  info(`Registering hosted ${provider} payment app with environment...`);

  try {
    const result = await client.registerApp(environmentId, 'payment', name);
    success(`Payment app registered successfully!`);
    info(`App ID: ${result.app.id}`);
    info(`Payment URL: ${PAYMENT_APP_URLS[provider]}`);
  } catch (err) {
    error(`Failed to register app: ${err}`);
    process.exit(1);
  }
}

async function registerLocalApp(
  environmentId: string,
  name: string,
  type: AppType
): Promise<void> {
  const token = requireToken();
  const client = new SaleorCloudClient(token);

  try {
    const result = await client.registerApp(environmentId, type, name);
    success(`App registered with environment!`);
    info(`App ID: ${result.app.id}`);
  } catch (err) {
    warning(`Could not register app automatically: ${err}`);
    info(`You can register manually in the dashboard.`);
  }
}

function warning(msg: string): void {
  console.log(`\x1b[33m${msg}\x1b[0m`);
}
