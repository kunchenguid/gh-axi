import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/gh.js', () => ({
  ghJson: vi.fn(),
  ghExec: vi.fn(),
  ghRaw: vi.fn(),
}));

import { ghJson, ghExec } from '../../src/gh.js';
import { runCommand, RUN_HELP } from '../../src/commands/run.js';
import { AxiError } from '../../src/errors.js';
import type { RepoContext } from '../../src/context.js';

const mockedGhJson = vi.mocked(ghJson);
const mockedGhExec = vi.mocked(ghExec);

const ctx: RepoContext = { owner: 'octo', name: 'repo', nwo: 'octo/repo', source: 'flag' };

describe('runCommand', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('router', () => {
    it('returns help when --help is passed', async () => {
      const result = await runCommand(['--help']);
      expect(result).toBe(RUN_HELP);
    });

    it('returns help when no subcommand is given', async () => {
      const result = await runCommand([]);
      expect(result).toBe(RUN_HELP);
    });

    it('returns error for unknown subcommand', async () => {
      const result = await runCommand(['unknown']);
      expect(result).toContain('Unknown subcommand: unknown');
    });
  });

  describe('list', () => {
    it('returns runs list', async () => {
      mockedGhJson.mockResolvedValue([
        { databaseId: 100, displayTitle: 'CI Build', status: 'completed', conclusion: 'success', workflowName: 'CI', headBranch: 'main', event: 'push', createdAt: '2024-01-01T00:00:00Z' },
        { databaseId: 101, displayTitle: 'Tests', status: 'in_progress', conclusion: null, workflowName: 'Test', headBranch: 'dev', event: 'pull_request', createdAt: '2024-01-02T00:00:00Z' },
      ]);

      const result = await runCommand(['list'], ctx);

      expect(result).toContain('count: 2');
      expect(result).toContain('CI Build');
      expect(result).toContain('Tests');
    });

    it('uses default compact --json fields when --fields is not passed', async () => {
      mockedGhJson.mockResolvedValue([]);
      await runCommand(['list'], ctx);

      const callArgs = mockedGhJson.mock.calls[0][0] as string[];
      const jsonIdx = callArgs.indexOf('--json');
      const jsonValue = callArgs[jsonIdx + 1];
      expect(jsonValue).not.toContain('headSha');
      expect(jsonValue).not.toContain('number');
      expect(jsonValue).toContain('databaseId');
      expect(jsonValue).toContain('displayTitle');
    });

    it('extends --json and schema when --fields is passed', async () => {
      mockedGhJson.mockResolvedValue([
        {
          databaseId: 100, displayTitle: 'CI Build', status: 'completed', conclusion: 'success',
          workflowName: 'CI', headBranch: 'main', event: 'push', createdAt: '2024-01-01T00:00:00Z',
          headSha: 'abc123', number: 42,
        },
      ]);

      const result = await runCommand(['list', '--fields', 'headSha,number'], ctx);

      const callArgs = mockedGhJson.mock.calls[0][0] as string[];
      const jsonIdx = callArgs.indexOf('--json');
      const jsonValue = callArgs[jsonIdx + 1];
      expect(jsonValue).toContain('headSha');
      expect(jsonValue).toContain('number');

      expect(result).toContain('abc123');
    });

    it('throws VALIDATION_ERROR for unknown --fields', async () => {
      await expect(
        runCommand(['list', '--fields', 'bogusField'], ctx),
      ).rejects.toThrow(AxiError);

      try {
        await runCommand(['list', '--fields', 'bogusField'], ctx);
      } catch (e) {
        expect((e as AxiError).code).toBe('VALIDATION_ERROR');
        expect((e as AxiError).message).toContain('bogusField');
      }
    });
  });

  describe('view', () => {
    it('returns run detail with jobs', async () => {
      mockedGhJson.mockResolvedValue({
        databaseId: 100,
        displayTitle: 'CI Build',
        status: 'completed',
        conclusion: 'success',
        workflowName: 'CI',
        headBranch: 'main',
        createdAt: '2024-01-01T00:00:00Z',
        jobs: [
          { name: 'build', status: 'completed', conclusion: 'success' },
          { name: 'test', status: 'completed', conclusion: 'failure' },
        ],
      });

      const result = await runCommand(['view', '100'], ctx);

      expect(result).toContain('CI Build');
      expect(result).toContain('build');
      expect(result).toContain('test');
    });

    it('omits help suggestions from detail view', async () => {
      mockedGhJson.mockResolvedValue({
        databaseId: 100, displayTitle: 'CI', status: 'completed', conclusion: 'success',
        workflowName: 'CI', headBranch: 'main', createdAt: '2024-01-01T00:00:00Z', jobs: [],
      });
      const result = await runCommand(['view', '100'], ctx);
      expect(result).not.toMatch(/^help\[/m);
    });
  });

  describe('view --log', () => {
    it('wraps log output in TOON envelope', async () => {
      mockedGhExec.mockResolvedValue('build step 1\nbuild step 2\ndone\n');
      const result = await runCommand(['view', '100', '--log'], ctx);
      expect(result).toContain('run_log:');
      expect(result).toContain('mode: log');
      expect(result).toContain('build step 1');
      expect(result).toContain('truncated: false');
    });

    it('wraps log-failed output in TOON envelope', async () => {
      mockedGhExec.mockResolvedValue('error in step 3\n');
      const result = await runCommand(['view', '100', '--log-failed'], ctx);
      expect(result).toContain('run_log:');
      expect(result).toContain('mode: log-failed');
      expect(result).toContain('error in step 3');
    });
  });

  describe('watch', () => {
    it('wraps watch output in TOON envelope', async () => {
      mockedGhExec.mockResolvedValue('Run completed\n');
      const result = await runCommand(['watch', '100'], ctx);
      expect(result).toContain('run_watch:');
      expect(result).toContain('Run completed');
    });
  });

  describe('cancel', () => {
    it('returns already_completed when run is already completed (idempotent)', async () => {
      mockedGhJson.mockResolvedValue({ status: 'completed', conclusion: 'success' });

      const result = await runCommand(['cancel', '100'], ctx);

      expect(result).toContain('already_completed');
      expect(mockedGhExec).not.toHaveBeenCalled();
    });
  });
});
