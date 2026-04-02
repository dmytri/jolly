import { describe, expect, mock, beforeEach, afterEach } from 'bun:test';
import { Given, When, Then, And } from './helpers';
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

describe('End-to-End Flows', () => {
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

  describe('Store Creation Flow', () => {
    Given('a valid token and working API', () => {
      When('creating a store end-to-end', () => {
        Then('it should call API and display project slug and dashboard URL', async () => {
          const fetchMock = mockFetch({
            '/organizations': { organizations: [fixtures.organization] },
            '/organizations/my-org/projects': { project: fixtures.project },
          });

          const { createStore } = await import('../commands/store');
          await createStore('my-store', 'us-east-1');

          expect(fetchMock).toHaveBeenCalled();

          const allTui = tuiCalls.map(c => c.msg).join('\n');
          expect(allTui).toContain('my-store');
          expect(allTui).toContain('cloud.saleor.io');
        });
      });
    });
  });

  describe('Store List Flow', () => {
    Given('a valid token and multiple organizations', () => {
      When('listing stores end-to-end', () => {
        Then('it should display all organizations with emails and dates', async () => {
          mockFetch({
            '/organizations': { organizations: [fixtures.organization, fixtures.organization2] },
          });

          const { listStores } = await import('../commands/store');
          await listStores();

          const allTui = tuiCalls.map(c => c.msg).join('\n');
          const allConsole = console_.logs.join('\n');
          expect(allTui).toContain('2 organization(s)');
          expect(allConsole).toContain('My Organization');
          expect(allConsole).toContain('owner@example.com');
          expect(allConsole).toContain('Other Organization');
          expect(allConsole).toContain('other@example.com');
        });
      });
    });
  });

  describe('Environment Creation Flow', () => {
    Given('a valid token and existing organization', () => {
      When('creating an environment end-to-end', () => {
        Then('it should call API and display environment key and domain', async () => {
          const fetchMock = mockFetch({
            '/organizations/my-org/projects/default/environments': { environment: fixtures.environment },
          });

          const { createEnvironment } = await import('../commands/store');
          await createEnvironment('my-org', 'staging');

          expect(fetchMock).toHaveBeenCalled();

          const allTui = tuiCalls.map(c => c.msg).join('\n');
          expect(allTui).toContain('staging');
          expect(allTui).toContain('saleor.cloud');
        });
      });
    });
  });

  describe('Payment App Registration Flow', () => {
    Given('a valid token and environment', () => {
      When('creating a payment app with environment', () => {
        Then('it should register via API and display app ID', async () => {
          const fetchMock = mockFetch({
            '/environments/staging/apps': { app: fixtures.app },
          });

          const { createApp } = await import('../commands/app');
          await createApp('my-payment', 'payment', 'staging', 'stripe');

          expect(fetchMock).toHaveBeenCalledTimes(1);

          const allTui = tuiCalls.map(c => c.msg).join('\n');
          expect(allTui).toContain('app-1');
          expect(allTui).toContain('stripe');
        });
      });
    });

    Given('a valid token but no environment', () => {
      When('creating a payment app without environment', () => {
        Then('it should display manual setup instructions', async () => {
          const { createApp } = await import('../commands/app');
          await createApp('my-payment', 'payment', undefined, 'stripe');

          const allTui = tuiCalls.map(c => c.msg).join('\n');
          expect(allTui).toContain('stripe');
          expect(allTui).toContain('cloud.saleor.io');
          expect(allTui).toContain('Third party apps');
        });
      });
    });
  });

  describe('Full Error Recovery Flow', () => {
    Given('no token set', () => {
      When('attempting any store operation', () => {
        Then('it should fail fast with auth error before API call', async () => {
          withoutToken();
          const fetchMock = mockFetch({ '/organizations': { organizations: [] } });

          const { listStores } = await import('../commands/store');

          try {
            await listStores();
          } catch {}

          expect(exitSpy).toHaveBeenCalledWith(1);
          expect(fetchMock).not.toHaveBeenCalled();
        });
      });
    });

    Given('a valid token but network failure', () => {
      And('the API returns 500', () => {
        When('creating a store', () => {
          Then('it should display the error and exit 1', async () => {
            mockFetchError(500, 'Internal Server Error');

            const { createStore } = await import('../commands/store');

            try {
              await createStore('fail-store', 'us-east-1');
            } catch {}

            expect(exitSpy).toHaveBeenCalledWith(1);
          });
        });
      });
    });
  });

  describe('API Client Request Construction', () => {
    Given('a SaleorCloudClient', () => {
      When('listing organizations', () => {
        Then('it should send correct URL, method, and headers', async () => {
          const fetchMock = mockFetch({
            '/organizations': { organizations: [fixtures.organization] },
          });

          const { SaleorCloudClient } = await import('../api/client');
          const client = new SaleorCloudClient(fixtures.token);
          await client.getOrganizations();

          expect(fetchMock).toHaveBeenCalledTimes(1);
          const [url, opts] = fetchMock.mock.calls[0];
          expect(url).toBe('https://cloud.saleor.io/api/organizations');
          expect(opts.method).toBe('GET');
          expect(opts.headers.Authorization).toBe(`Token ${fixtures.token}`);
        });
      });

      When('creating a project', () => {
        Then('it should send correct URL, method, headers, and body', async () => {
          const fetchMock = mockFetch({
            '/organizations/default/projects': { project: fixtures.project },
          });

          const { SaleorCloudClient } = await import('../api/client');
          const client = new SaleorCloudClient(fixtures.token);
          await client.createProject('default', 'test-store', 'eu-west-1');

          expect(fetchMock).toHaveBeenCalledTimes(1);
          const [url, opts] = fetchMock.mock.calls[0];
          expect(url).toBe('https://cloud.saleor.io/api/organizations/default/projects');
          expect(opts.method).toBe('POST');
          expect(opts.headers.Authorization).toBe(`Token ${fixtures.token}`);
          expect(JSON.parse(opts.body)).toEqual({ name: 'test-store', region: 'eu-west-1' });
        });
      });

      When('registering an app', () => {
        Then('it should send correct URL with environment key', async () => {
          const fetchMock = mockFetch({
            '/environments/staging/apps': { app: fixtures.app },
          });

          const { SaleorCloudClient } = await import('../api/client');
          const client = new SaleorCloudClient(fixtures.token);
          await client.registerApp('staging', 'payment', 'my-app');

          const [url, opts] = fetchMock.mock.calls[0];
          expect(url).toBe('https://cloud.saleor.io/api/environments/staging/apps');
          expect(JSON.parse(opts.body)).toEqual({ type: 'payment', name: 'my-app' });
        });
      });
    });
  });
});
