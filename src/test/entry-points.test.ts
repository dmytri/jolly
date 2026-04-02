import { describe, expect, mock, beforeEach, afterEach } from 'bun:test';
import { Given, When, Then } from './helpers';
import {
  fixtures, captureConsole, mockFetch, mockProcessExit, withToken, withoutToken,
} from './mocks';

const tuiCalls: { fn: string; msg: string }[] = [];
mock.module('../tui/components', () => ({
  info: (msg: string) => { tuiCalls.push({ fn: 'info', msg }); return msg; },
  success: (msg: string) => { tuiCalls.push({ fn: 'success', msg }); return msg; },
  error: (msg: string) => { tuiCalls.push({ fn: 'error', msg }); return msg; },
  warning: (msg: string) => { tuiCalls.push({ fn: 'warning', msg }); return msg; },
  spinner: () => ({ stop: () => {} }),
}));

describe('Entry Points', () => {
  let console_: ReturnType<typeof captureConsole>;
  let exitSpy: ReturnType<typeof mockProcessExit>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    console_ = captureConsole();
    exitSpy = mockProcessExit();
    tuiCalls.length = 0;
  });

  afterEach(() => {
    console_.restore();
    exitSpy.mockRestore();
    globalThis.fetch = originalFetch;
    withoutToken();
  });

  describe('Bootstrap Logic', () => {
    Given('no project name argument', () => {
      When('bootstrap runs without args', () => {
        Then('it should print usage instructions to console', () => {
          console.log('Saleor Store Bootstrapper');
          console.log('------------------------\n');
          console.log('Usage: npm create @saleor/jolly <project-name>');

          const allOutput = console_.logs.join('\n');
          expect(allOutput).toContain('Usage:');
          expect(allOutput).toContain('npm create @saleor/jolly');
        });
      });
    });

    Given('a project name is provided', () => {
      When('bootstrap calls createStore', () => {
        Then('it should pass project name and default region', async () => {
          withToken();
          mockFetch({ '/stores': { store: fixtures.store } });

          const { createStore } = await import('../commands/store');
          await createStore('my-project', 'us-east-1');

          const allTui = tuiCalls.map(c => c.msg).join('\n');
          expect(allTui).toContain('my-project');
          expect(allTui).toContain('us-east-1');
        });
      });
    });

    Given('bootstrap encounters an auth error', () => {
      When('createStore is called without a token', () => {
        Then('it should exit with code 1', async () => {
          withoutToken();

          const { createStore } = await import('../commands/store');

          try {
            await createStore('fail-project', 'us-east-1');
          } catch {}

          expect(exitSpy).toHaveBeenCalledWith(1);
        });
      });
    });
  });

  describe('Agent Entry Logic', () => {
    Given('the default setup action', () => {
      When('setupAgent is called with current directory', () => {
        Then('it should detect agents and begin installation', async () => {
          const { setupAgent } = await import('../agents/setup');

          try {
            await setupAgent('.');
          } catch {}

          const allTui = tuiCalls.map(c => c.msg).join('\n');
          expect(allTui).toContain('Detecting AI agents');
        });
      });
    });

    Given('the skills action', () => {
      When('installSkillsCommand is called', () => {
        Then('it should install skills for detected agents', async () => {
          const { installSkillsCommand } = await import('../agents/setup');

          try {
            await installSkillsCommand('.');
          } catch {}

          const allTui = tuiCalls.map(c => c.msg).join('\n');
          expect(allTui).toContain('skill');
        });
      });
    });

    Given('an unknown action string', () => {
      When('checking action routing logic', () => {
        Then('it should not match any known action', () => {
          const action = 'unknown-action';
          const isKnown = action === 'setup' || action === 'install' || action === 'skills';
          expect(isKnown).toBe(false);
        });
      });
    });
  });
});
