import { mock, spyOn } from 'bun:test';
import type { Store, Environment, App } from '../api/client';

export const fixtures = {
  token: 'test-token-abc123',

  store: {
    id: 'store-1',
    name: 'my-store',
    region: 'us-east-1',
    created_at: '2025-01-01T00:00:00Z',
  } satisfies Store,

  store2: {
    id: 'store-2',
    name: 'other-store',
    region: 'eu-west-1',
    created_at: '2025-06-15T00:00:00Z',
  } satisfies Store,

  environment: {
    id: 'env-1',
    name: 'staging',
    store_id: 'store-1',
    created_at: '2025-01-02T00:00:00Z',
  } satisfies Environment,

  app: {
    id: 'app-1',
    name: 'my-app',
    type: 'payment',
    environment_id: 'env-1',
  } satisfies App,
};

export function mockFetch(routes: Record<string, unknown>): ReturnType<typeof mock> {
  const handler = mock((url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;

    for (const [pattern, body] of Object.entries(routes)) {
      if (urlStr.includes(pattern)) {
        return Promise.resolve(new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
    }

    return Promise.resolve(new Response('Not Found', { status: 404 }));
  });

  globalThis.fetch = handler as typeof fetch;
  return handler;
}

export function mockFetchError(status: number, statusText: string): ReturnType<typeof mock> {
  const handler = mock(() =>
    Promise.resolve(new Response(JSON.stringify({ error: statusText }), {
      status,
      statusText,
    }))
  );
  globalThis.fetch = handler as typeof fetch;
  return handler;
}

export function mockProcessExit() {
  return spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('process.exit called');
  }) as () => never);
}

export function captureConsole() {
  const logs: string[] = [];
  const errors: string[] = [];

  const logSpy = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });
  const errorSpy = spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  });

  return {
    logs,
    errors,
    logSpy,
    errorSpy,
    restore() {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    },
  };
}

export function withToken(token = fixtures.token) {
  process.env.SALEOR_CLOUD_TOKEN = token;
}

export function withoutToken() {
  delete process.env.SALEOR_CLOUD_TOKEN;
}

export async function parseArgs(
  commandModule: unknown,
  args: string[]
): Promise<{ argv?: Record<string, unknown>; error?: string }> {
  const yargsModule = await import('yargs');
  const yargs = yargsModule.default;
  const helpers = await import('yargs/helpers');
  const hideBin = helpers.hideBin;

  return new Promise((resolve) => {
    try {
      const parser = (yargs(hideBin(args)) as any)
        .command(commandModule)
        .strict()
        .exitProcess(false);

      parser.fail((msg: string) => {
        resolve({ error: msg });
      });

      const parsed = parser.parse(args);
      if (parsed && typeof parsed === 'object') {
        resolve({ argv: parsed as Record<string, unknown> });
      }
    } catch (err) {
      resolve({ error: (err as Error).message });
    }
  });
}
