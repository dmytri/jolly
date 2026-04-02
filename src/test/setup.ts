import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

export { describe, it, expect, beforeAll, afterAll };

export const testEnv = {
  clear: () => {
    delete process.env.SALEOR_CLOUD_TOKEN;
    delete process.env.SALEOR_API_URL;
  },
  setToken: (token: string) => {
    process.env.SALEOR_CLOUD_TOKEN = token;
  },
  setApiUrl: (url: string) => {
    process.env.SALEOR_API_URL = url;
  },
};

export async function mockFetch(response: unknown, status = 200): Promise<void> {
  const globalFetch = globalThis.fetch;
  
  globalThis.fetch = (url: string | URL | Request, init?: RequestInit) => {
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: () => Promise.resolve(response),
    }) as Response;
  };
}
