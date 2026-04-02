import { describe, expect, beforeEach, afterEach } from 'bun:test';
import { Given, When, Then } from './helpers';
import {
  fixtures, captureConsole, mockFetch, mockFetchError,
  mockProcessExit, withToken, withoutToken,
} from './mocks';

describe('Error Handling', () => {
  let console_: ReturnType<typeof captureConsole>;
  let exitSpy: ReturnType<typeof mockProcessExit>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    console_ = captureConsole();
    exitSpy = mockProcessExit();
  });

  afterEach(() => {
    console_.restore();
    exitSpy.mockRestore();
    globalThis.fetch = originalFetch;
    withoutToken();
  });

  describe('Auth Token Validation', () => {
    Given('no SALEOR_CLOUD_TOKEN in environment', () => {
      When('calling requireToken', () => {
        Then('it should print error message with token URL', async () => {
          withoutToken();

          const { requireToken } = await import('../api/auth');

          try {
            requireToken();
          } catch {}

          const allErrors = console_.errors.join('\n');
          expect(allErrors).toContain('SALEOR_CLOUD_TOKEN');
          expect(allErrors).toContain('cloud.saleor.io');
          expect(exitSpy).toHaveBeenCalledWith(1);
        });
      });

      When('calling getToken', () => {
        Then('it should throw with descriptive message', async () => {
          withoutToken();

          const { getToken } = await import('../api/auth');
          expect(() => getToken()).toThrow('SALEOR_CLOUD_TOKEN');
        });
      });
    });

    Given('an empty string SALEOR_CLOUD_TOKEN', () => {
      When('creating a SaleorCloudClient', () => {
        Then('it should throw', async () => {
          process.env.SALEOR_CLOUD_TOKEN = '';

          const { SaleorCloudClient } = await import('../api/client');
          expect(() => new SaleorCloudClient()).toThrow('SALEOR_CLOUD_TOKEN');
        });
      });
    });
  });

  describe('API Error Responses', () => {
    Given('a valid token', () => {
      beforeEach(() => {
        withToken();
      });

      When('API returns 401 Unauthorized', () => {
        Then('the client should throw with status info', async () => {
          mockFetchError(401, 'Unauthorized');

          const { SaleorCloudClient } = await import('../api/client');
          const client = new SaleorCloudClient(fixtures.token);

          await expect(client.getOrganizations()).rejects.toThrow('401');
        });
      });

      When('API returns 403 Forbidden', () => {
        Then('the client should throw with status info', async () => {
          mockFetchError(403, 'Forbidden');

          const { SaleorCloudClient } = await import('../api/client');
          const client = new SaleorCloudClient(fixtures.token);

          await expect(client.createProject('test-org', 'test', 'us-east-1')).rejects.toThrow('403');
        });
      });

      When('API returns 500 Internal Server Error', () => {
        Then('the client should throw with status info', async () => {
          mockFetchError(500, 'Internal Server Error');

          const { SaleorCloudClient } = await import('../api/client');
          const client = new SaleorCloudClient(fixtures.token);

          await expect(client.getEnvironments('test-org', 'test-project')).rejects.toThrow('500');
        });
      });

      When('API returns 404 for non-existent resource', () => {
        Then('the client should throw with status info', async () => {
          mockFetchError(404, 'Not Found');

          const { SaleorCloudClient } = await import('../api/client');
          const client = new SaleorCloudClient(fixtures.token);

          await expect(client.createEnvironment('bad-org', 'bad-project', 'staging', 'us-east-1')).rejects.toThrow('404');
        });
      });
    });
  });

  describe('API Request Headers', () => {
    Given('a SaleorCloudClient with a token', () => {
      When('making any request', () => {
        Then('it should include Authorization Token header', async () => {
          const fetchMock = mockFetch({
            '/organizations': { organizations: [] },
          });

          const { SaleorCloudClient } = await import('../api/client');
          const client = new SaleorCloudClient(fixtures.token);
          await client.getOrganizations();

          const [, opts] = fetchMock.mock.calls[0];
          expect(opts.headers.Authorization).toBe(`Token ${fixtures.token}`);
          expect(opts.headers['Content-Type']).toBe('application/json');
        });
      });
    });
  });
});
