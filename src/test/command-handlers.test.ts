import { describe, expect, mock, beforeEach, afterEach } from 'bun:test';
import { Given, When, Then } from './helpers';
import {
  fixtures, captureConsole, mockFetch, mockFetchError,
  mockProcessExit, withToken, withoutToken,
} from './mocks';

const tuiCalls: { fn: string; msg: string }[] = [];
mock.module('../tui/components', () => ({
  info: (msg: string) => { tuiCalls.push({ fn: 'info', msg }); return msg; },
  success: (msg: string) => { tuiCalls.push({ fn: 'success', msg }); return msg; },
  error: (msg: string) => { tuiCalls.push({ fn: 'error', msg }); return msg; },
  warning: (msg: string) => { tuiCalls.push({ fn: 'warning', msg }); return msg; },
  spinner: () => ({ stop: () => {} }),
}));

describe('Command Handlers', () => {
  let console_: ReturnType<typeof captureConsole>;
  let exitSpy: ReturnType<typeof mockProcessExit>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    console_ = captureConsole();
    exitSpy = mockProcessExit();
    tuiCalls.length = 0;
    withToken();
  });

  afterEach(() => {
    console_.restore();
    exitSpy.mockRestore();
    globalThis.fetch = originalFetch;
    withoutToken();
  });

  describe('Store Handlers', () => {
    Given('a valid token and successful API', () => {
      When('calling createStore', () => {
        Then('it should call POST /stores with name and region', async () => {
          const fetchMock = mockFetch({
            '/stores': { store: fixtures.store },
          });

          const { createStore } = await import('../commands/store');
          await createStore('my-store', 'us-east-1');

          expect(fetchMock).toHaveBeenCalledTimes(1);
          const [url, opts] = fetchMock.mock.calls[0];
          expect(url).toContain('/stores');
          expect(opts.method).toBe('POST');
          expect(JSON.parse(opts.body)).toEqual({ name: 'my-store', region: 'us-east-1' });
        });
      });

      When('calling listStores with results', () => {
        Then('it should display store names and IDs', async () => {
          mockFetch({
            '/stores': { stores: [fixtures.store, fixtures.store2] },
          });

          const { listStores } = await import('../commands/store');
          await listStores();

          const allOutput = console_.logs.join('\n');
          expect(allOutput).toContain('my-store');
          expect(allOutput).toContain('store-1');
          expect(allOutput).toContain('other-store');
          expect(allOutput).toContain('store-2');
        });
      });

      When('calling listStores with empty results', () => {
        Then('it should display a helpful message', async () => {
          mockFetch({
            '/stores': { stores: [] },
          });

          const { listStores } = await import('../commands/store');
          await listStores();

          const infoMessages = tuiCalls.filter(c => c.fn === 'info').map(c => c.msg).join('\n');
          expect(infoMessages).toContain('No stores found');
        });
      });

      When('calling createEnvironment', () => {
        Then('it should call POST /stores/:id/environments', async () => {
          const fetchMock = mockFetch({
            '/stores/store-1/environments': { environment: fixtures.environment },
          });

          const { createEnvironment } = await import('../commands/store');
          await createEnvironment('store-1', 'staging');

          expect(fetchMock).toHaveBeenCalledTimes(1);
          const [url, opts] = fetchMock.mock.calls[0];
          expect(url).toContain('/stores/store-1/environments');
          expect(opts.method).toBe('POST');
          expect(JSON.parse(opts.body)).toEqual({ name: 'staging' });
        });
      });
    });

    Given('a valid token but failing API', () => {
      When('calling createStore and API returns 500', () => {
        Then('it should print error and exit 1', async () => {
          mockFetchError(500, 'Internal Server Error');

          const { createStore } = await import('../commands/store');

          try {
            await createStore('fail-store', 'us-east-1');
          } catch {}

          expect(exitSpy).toHaveBeenCalledWith(1);
        });
      });

      When('calling listStores and API returns 401', () => {
        Then('it should print error and exit 1', async () => {
          mockFetchError(401, 'Unauthorized');

          const { listStores } = await import('../commands/store');

          try {
            await listStores();
          } catch {}

          expect(exitSpy).toHaveBeenCalledWith(1);
        });
      });

      When('calling createEnvironment and API returns 404', () => {
        Then('it should print error and exit 1', async () => {
          mockFetchError(404, 'Not Found');

          const { createEnvironment } = await import('../commands/store');

          try {
            await createEnvironment('bad-store', 'staging');
          } catch {}

          expect(exitSpy).toHaveBeenCalledWith(1);
        });
      });
    });

    Given('no token is set', () => {
      When('calling createStore', () => {
        Then('it should exit with code 1 from requireToken', async () => {
          withoutToken();

          const { createStore } = await import('../commands/store');

          try {
            await createStore('no-token-store', 'us-east-1');
          } catch {}

          expect(exitSpy).toHaveBeenCalledWith(1);
        });
      });

      When('calling listStores', () => {
        Then('it should exit with code 1 from requireToken', async () => {
          withoutToken();

          const { listStores } = await import('../commands/store');

          try {
            await listStores();
          } catch {}

          expect(exitSpy).toHaveBeenCalledWith(1);
        });
      });
    });
  });

  describe('App Handlers', () => {
    Given('a payment app with no environment', () => {
      When('calling createApp', () => {
        Then('it should print hosted payment app instructions', async () => {
          const { createApp } = await import('../commands/app');
          await createApp('pay-app', 'payment', undefined, 'stripe');

          const allTuiOutput = tuiCalls.map(c => c.msg).join('\n');
          expect(allTuiOutput).toContain('payment');
          expect(allTuiOutput).toContain('stripe');
        });
      });
    });

    Given('a payment app with environment and valid token', () => {
      When('calling createApp', () => {
        Then('it should register the hosted app via API', async () => {
          const fetchMock = mockFetch({
            '/environments/env-1/apps': { app: fixtures.app },
          });

          const { createApp } = await import('../commands/app');
          await createApp('pay-app', 'payment', 'env-1', 'dummy');

          expect(fetchMock).toHaveBeenCalledTimes(1);
          const [url, opts] = fetchMock.mock.calls[0];
          expect(url).toContain('/environments/env-1/apps');
          expect(opts.method).toBe('POST');
        });
      });
    });

    Given('a payment app with environment but failing API', () => {
      When('calling createApp', () => {
        Then('it should print error and exit 1', async () => {
          mockFetchError(500, 'Internal Server Error');

          const { createApp } = await import('../commands/app');

          try {
            await createApp('pay-app', 'payment', 'env-1', 'dummy');
          } catch {}

          expect(exitSpy).toHaveBeenCalledWith(1);
        });
      });
    });
  });
});
