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
    console.error('Error: SALEOR_CLOUD_TOKEN environment variable is required');
    console.error('Get your token at: https://cloud.saleor.io/settings/api-tokens');
    process.exit(1);
  }
  return token;
}
