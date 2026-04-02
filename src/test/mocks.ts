import { mock, spyOn } from 'bun:test';
import type { Organization, Project, Environment, App } from '../api/client';

export const fixtures = {
  token: 'test-token-abc123',

  // New API structure: Organizations → Projects → Environments
  organization: {
    slug: 'my-org',
    name: 'My Organization',
    created: '2025-01-01T00:00:00Z',
    owner_email: 'owner@example.com',
    company_name: 'My Company',
  } satisfies Organization,

  organization2: {
    slug: 'other-org',
    name: 'Other Organization',
    created: '2025-06-15T00:00:00Z',
    owner_email: 'other@example.com',
  } satisfies Organization,

  project: {
    slug: 'my-store',
    name: 'my-store',
    region: 'us-east-1',
    created: '2025-01-01T00:00:00Z',
    sandboxes: { count: 2 },
  } satisfies Project,

  project2: {
    slug: 'other-store',
    name: 'other-store',
    region: 'eu-west-1',
    created: '2025-06-15T00:00:00Z',
    sandboxes: { count: 1 },
  } satisfies Project,

  environment: {
    key: 'staging',
    name: 'staging',
    domain: 'staging-my-store.saleor.cloud',
    service: {
      version: '3.15.0',
      type: 'main',
      region: 'us-east-1',
    },
    created: '2025-01-02T00:00:00Z',
    project: { name: 'my-store', slug: 'my-store' },
  } satisfies Environment,

  app: {
    id: 'app-1',
    name: 'my-app',
    type: 'payment',
    environment_id: 'staging',
  } satisfies App,

  // Backward compat aliases (for tests that haven't been migrated yet)
  store: {
    id: 'my-org',
    name: 'My Organization',
    region: 'us-east-1',
    created_at: '2025-01-01T00:00:00Z',
  },
  store2: {
    id: 'other-org',
    name: 'Other Organization',
    region: 'eu-west-1',
    created_at: '2025-06-15T00:00:00Z',
  },
};

export function mockFetch(routes: Record<string, unknown>): ReturnType<typeof mock> {
  const handler = mock((url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;

    const sortedEntries = Object.entries(routes).sort((a, b) => b[0].length - a[0].length);

    for (const [pattern, body] of sortedEntries) {
      if (urlStr.endsWith(pattern)) {
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
