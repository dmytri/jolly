import { config } from '@dotenvx/dotenvx';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

config();

export function getToken(): string {
  const token = process.env.SALEOR_CLOUD_TOKEN;
  if (!token) {
    throw new Error('SALEOR_CLOUD_TOKEN environment variable is required');
  }
  return token;
}

export function requireToken(): string {
  const token = process.env.SALEOR_CLOUD_TOKEN;
  if (!token) {
    console.error('\n🔑 Saleor Cloud Token Required');
    console.error('   Get your token at: https://cloud.saleor.io/settings/api-tokens\n');
    console.error('Or create a .env file with: SALEOR_CLOUD_TOKEN=your-token');
    console.error('\nTo set token: export SALEOR_CLOUD_TOKEN=your-token\n');
    process.exit(1);
  }
  return token;
}

export async function promptAndSaveToken(): Promise<string> {
  console.log('\n🔑 Saleor Cloud Token Required');
  console.log('   Get your token at: https://cloud.saleor.io/settings/api-tokens\n');

  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question('Enter your SALEOR_CLOUD_TOKEN: ', (answer: string) => {
      rl.close();
      const token = answer.trim();

      if (!token) {
        console.error('Error: Token cannot be empty');
        process.exit(1);
      }

      const envPath = join(process.cwd(), '.env');
      const envLine = `SALEOR_CLOUD_TOKEN=${token}\n`;

      try {
        let existingContent = '';
        if (existsSync(envPath)) {
          existingContent = readFileSync(envPath, 'utf-8');
          if (existingContent.includes('SALEOR_CLOUD_TOKEN=')) {
            existingContent = existingContent.replace(
              /SALEOR_CLOUD_TOKEN=.*\n?/g,
              envLine
            );
          } else {
            existingContent += envLine;
          }
        } else {
          existingContent = envLine;
        }
        writeFileSync(envPath, existingContent);
        console.log('\n✅ Token saved to .env file');
      } catch {
        console.log('\n⚠️  Could not save to .env, token will not persist');
      }

      process.env.SALEOR_CLOUD_TOKEN = token;
      resolve(token);
    });
  });
}
