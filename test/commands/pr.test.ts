import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/gh.js', () => ({
  ghJson: vi.fn(),
  ghExec: vi.fn(),
  ghRaw: vi.fn(),
}));

import { ghJson, ghExec, ghRaw } from '../../src/gh.js';
import { prCommand, PR_HELP } from '../../src/commands/pr.js';
import { AxiError } from '../../src/errors.js';
import type { RepoContext } from '../../src/context.js';

const mockedGhJson = vi.mocked(ghJson);
const mockedGhExec = vi.mocked(ghExec);
const mockedGhRaw = vi.mocked(ghRaw);

const ctx: RepoContext = { owner: 'octo', name: 'repo', nwo: 'octo/repo', source: 'flag' };

describe('prCommand', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('router', () => {
    it('returns help when --help is passed', async () => {
      const result = await prCommand(['--help']);
      expect(result).toBe(PR_HELP);
    });

    it('returns help when no subcommand is given', async () => {
      const result = await prCommand([]);
      expect(result).toBe(PR_HELP);
    });

    it('returns error for unknown subcommand', async () => {
      const result = await prCommand(['unknown']);
      expect(result).toContain('Unknown pr subcommand: unknown');
    });
  });

  describe('list', () => {
    it('returns list with count line', async () => {
      mockedGhJson.mockResolvedValue([
        { number: 1, title: 'Fix bug', state: 'OPEN', author: { login: 'alice' }, isDraft: false, reviewDecision: 'APPROVED' },
        { number: 2, title: 'Add feature', state: 'OPEN', author: { login: 'bob' }, isDraft: true, reviewDecision: '' },
      ]);

      const result = await prCommand(['list'], ctx);

      expect(result).toContain('count: 2');
      expect(result).toContain('Fix bug');
      expect(result).toContain('Add feature');
      expect(mockedGhJson).toHaveBeenCalledWith(
        expect.arrayContaining(['pr', 'list', '--json']),
        ctx,
      );
    });

    it('uses default compact --json fields when --fields is not passed', async () => {
      mockedGhJson.mockResolvedValue([]);
      await prCommand(['list'], ctx);

      const callArgs = mockedGhJson.mock.calls[0][0] as string[];
      const jsonIdx = callArgs.indexOf('--json');
      const jsonValue = callArgs[jsonIdx + 1];
      expect(jsonValue).not.toContain('body');
      expect(jsonValue).not.toContain('createdAt');
      expect(jsonValue).toContain('number');
      expect(jsonValue).toContain('title');
    });

    it('extends --json and schema when --fields is passed', async () => {
      mockedGhJson.mockResolvedValue([
        {
          number: 1, title: 'Fix', state: 'OPEN', author: { login: 'alice' },
          isDraft: false, reviewDecision: 'APPROVED',
          body: 'PR body text', createdAt: '2024-01-01T00:00:00Z',
        },
      ]);

      const result = await prCommand(['list', '--fields', 'body,createdAt'], ctx);

      const callArgs = mockedGhJson.mock.calls[0][0] as string[];
      const jsonIdx = callArgs.indexOf('--json');
      const jsonValue = callArgs[jsonIdx + 1];
      expect(jsonValue).toContain('body');
      expect(jsonValue).toContain('createdAt');

      expect(result).toContain('PR body text');
    });

    it('throws VALIDATION_ERROR for unknown --fields', async () => {
      await expect(
        prCommand(['list', '--fields', 'fakeField'], ctx),
      ).rejects.toThrow(AxiError);

      try {
        await prCommand(['list', '--fields', 'fakeField'], ctx);
      } catch (e) {
        expect((e as AxiError).code).toBe('VALIDATION_ERROR');
        expect((e as AxiError).message).toContain('fakeField');
      }
    });
  });

  describe('view', () => {
    it('returns detail with schema fields', async () => {
      mockedGhJson.mockResolvedValue({
        number: 42,
        title: 'My PR',
        state: 'OPEN',
        author: { login: 'alice' },
        isDraft: false,
        mergedAt: null,
        statusCheckRollup: [],
        body: 'PR description here',
        comments: [],
      });

      const result = await prCommand(['view', '42'], ctx);

      expect(result).toContain('42');
      expect(result).toContain('My PR');
      expect(result).toContain('open');
      expect(result).toContain('alice');
    });

    it('omits help suggestions from detail view', async () => {
      mockedGhJson.mockResolvedValue({
        number: 42, title: 'My PR', state: 'OPEN', author: { login: 'alice' },
        isDraft: false, mergedAt: null, statusCheckRollup: [], body: 'desc', comments: [],
      });
      const result = await prCommand(['view', '42'], ctx);
      expect(result).not.toMatch(/^help\[/m);
    });
  });

  describe('close', () => {
    it('returns already closed when PR is already closed (idempotent)', async () => {
      mockedGhJson.mockResolvedValue({ state: 'CLOSED' });

      const result = await prCommand(['close', '10'], ctx);

      expect(result).toContain('closed');
      expect(result).toContain('already');
      expect(mockedGhExec).not.toHaveBeenCalled();
    });
  });

  describe('merge', () => {
    it('returns already merged when PR is already merged (idempotent)', async () => {
      mockedGhJson.mockResolvedValue({
        state: 'MERGED',
        mergedBy: { login: 'alice' },
        mergedAt: '2024-01-01T00:00:00Z',
      });

      const result = await prCommand(['merge', '10'], ctx);

      expect(result).toContain('merged');
      expect(result).toContain('alice');
      expect(mockedGhExec).not.toHaveBeenCalled();
    });
  });

  describe('checks', () => {
    it('returns message when no checks configured', async () => {
      mockedGhJson.mockResolvedValue({ statusCheckRollup: [] });

      const result = await prCommand(['checks', '5'], ctx);

      expect(result).toContain('no CI checks configured');
    });

    it('returns check summary with checks', async () => {
      mockedGhJson.mockResolvedValue({
        statusCheckRollup: [
          { name: 'build', conclusion: 'SUCCESS' },
          { name: 'lint', conclusion: 'FAILURE' },
          { name: 'test', conclusion: 'SKIPPED' },
        ],
      });

      const result = await prCommand(['checks', '5'], ctx);

      expect(result).toContain('1 passed');
      expect(result).toContain('1 failed');
      expect(result).toContain('1 skipped');
      expect(result).toContain('3 total');
    });
  });

  describe('diff', () => {
    it('wraps diff output in TOON envelope', async () => {
      mockedGhExec.mockResolvedValue('diff --git a/file.ts b/file.ts\n+added line\n');

      const result = await prCommand(['diff', '7'], ctx);

      expect(result).toContain('pr_diff:');
      expect(result).toContain('number: 7');
      expect(result).toContain('diff --git');
      expect(result).toContain('truncated: false');
    });

    it('truncates large diffs with metadata', async () => {
      const largeDiff = 'x'.repeat(25000);
      mockedGhExec.mockResolvedValue(largeDiff);

      const result = await prCommand(['diff', '7'], ctx);

      expect(result).toContain('truncated: true');
      expect(result).toContain('original_length: 25000');
    });

    it('skips truncation with --full flag', async () => {
      const largeDiff = 'x'.repeat(25000);
      mockedGhExec.mockResolvedValue(largeDiff);

      const result = await prCommand(['diff', '7', '--full'], ctx);

      expect(result).toContain('truncated: false');
      expect(result).not.toContain('original_length');
    });
  });
});
