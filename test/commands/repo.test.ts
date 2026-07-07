import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/gh.js', () => ({
  ghJson: vi.fn(),
  ghExec: vi.fn(),
  ghRaw: vi.fn(),
}));

import { ghJson, ghExec } from '../../src/gh.js';
import { repoCommand, REPO_HELP } from '../../src/commands/repo.js';
import { AxiError } from '../../src/errors.js';
import type { RepoContext } from '../../src/context.js';

const mockedGhJson = vi.mocked(ghJson);
const mockedGhExec = vi.mocked(ghExec);

const ctx: RepoContext = { owner: 'octo', name: 'repo', nwo: 'octo/repo', source: 'flag' };

describe('repoCommand', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('router', () => {
    it('returns help when --help is passed', async () => {
      const result = await repoCommand(['--help'], ctx);
      expect(result).toBe(REPO_HELP);
    });

    it('returns help when no subcommand is given', async () => {
      const result = await repoCommand([], ctx);
      expect(result).toBe(REPO_HELP);
    });

    it('returns error for unknown subcommand', async () => {
      const result = await repoCommand(['unknown'], ctx);
      expect(result).toContain('Unknown subcommand: unknown');
    });
  });

  describe('view', () => {
    it('returns repo detail', async () => {
      mockedGhJson.mockResolvedValue({
        name: 'repo',
        description: 'A test repo',
        defaultBranchRef: { name: 'main' },
        stargazerCount: 42,
        forkCount: 5,
        issues: { totalCount: 10 },
        pullRequests: { totalCount: 3 },
        visibility: 'PUBLIC',
        primaryLanguage: { name: 'TypeScript' },
      });

      const result = await repoCommand(['view'], ctx);

      expect(result).toContain('repo');
      expect(result).toContain('A test repo');
      expect(result).toContain('main');
      expect(result).toContain('TypeScript');
      expect(mockedGhJson).toHaveBeenCalledTimes(1);
    });

    it('passes repo nwo as positional arg when ctx is provided', async () => {
      mockedGhJson.mockResolvedValue({ name: 'repo' });

      await repoCommand(['view'], ctx);

      const callArgs = mockedGhJson.mock.calls[0][0];
      expect(callArgs).toContain('octo/repo');
    });

    it('passes a positional owner/name repo to gh repo view without flag context', async () => {
      mockedGhJson.mockResolvedValue({ name: 'agent-os' });

      await repoCommand(['view', 'minekube/agent-os'], {
        ...ctx,
        source: 'git',
      });

      const callArgs = mockedGhJson.mock.calls[0][0];
      expect(callArgs).toContain('minekube/agent-os');
      expect(callArgs).not.toContain('octo/repo');
    });

    it('rejects a positional repo selector when repo context comes from --repo', async () => {
      await expect(
        repoCommand(['view', 'minekube/agent-os'], ctx),
      ).rejects.toThrow(
        'Unsupported positional argument for repo view with --repo: minekube/agent-os. Use --repo <owner/name> to select a repository.',
      );
      expect(mockedGhJson).not.toHaveBeenCalled();
    });

    it('keeps bare ambient repo view when no repo context exists', async () => {
      mockedGhJson.mockResolvedValue({ name: 'repo' });

      await repoCommand(['view']);

      expect(mockedGhJson).toHaveBeenCalledWith([
        'repo',
        'view',
        '--json',
        'name,description,defaultBranchRef,stargazerCount,forkCount,issues,pullRequests,visibility,primaryLanguage',
      ]);
    });

    it('rejects extra positional args for repo view', async () => {
      await expect(
        repoCommand(['view', 'minekube/agent-os', 'extra'], {
          ...ctx,
          source: 'git',
        }),
      ).rejects.toThrow(
        'Unsupported positional argument for repo view: extra. Use --repo <owner/name> to select a repository.',
      );
      expect(mockedGhJson).not.toHaveBeenCalled();
    });

    it('omits help suggestions from detail view', async () => {
      mockedGhJson.mockResolvedValue({
        name: 'repo', description: 'test', defaultBranchRef: { name: 'main' },
        stargazerCount: 0, forkCount: 0, issues: { totalCount: 0 },
        pullRequests: { totalCount: 0 }, visibility: 'PUBLIC', primaryLanguage: { name: 'Go' },
      });
      const result = await repoCommand(['view'], ctx);
      expect(result).not.toMatch(/^help\[/m);
    });
  });

  describe('create', () => {
    it('creates a repo with required name', async () => {
      mockedGhExec.mockResolvedValue('');

      const result = await repoCommand(['create', 'my-new-repo']);

      expect(result).toContain('created');
      expect(result).toContain('my-new-repo');
      expect(mockedGhExec).toHaveBeenCalledWith(
        expect.arrayContaining(['repo', 'create', 'my-new-repo']),
      );
    });

    it('throws when name is missing', async () => {
      await expect(
        repoCommand(['create']),
      ).rejects.toThrow(AxiError);
    });

    it('passes --public flag', async () => {
      mockedGhExec.mockResolvedValue('');

      await repoCommand(['create', 'my-repo', '--public']);

      expect(mockedGhExec).toHaveBeenCalledWith(
        expect.arrayContaining(['--public']),
      );
    });
  });

  describe('list', () => {
    it('emits count line with number of repos', async () => {
      mockedGhJson.mockResolvedValue([
        { name: 'repo-a', description: 'First', visibility: 'PUBLIC', primaryLanguage: { name: 'TypeScript' }, stargazerCount: 10, updatedAt: '2024-01-01T00:00:00Z' },
        { name: 'repo-b', description: 'Second', visibility: 'PRIVATE', primaryLanguage: { name: 'Go' }, stargazerCount: 5, updatedAt: '2024-01-02T00:00:00Z' },
      ]);

      const result = await repoCommand(['list'], ctx);

      expect(result).toContain('count: 2');
    });

    it('emits count: 0 when no repos exist', async () => {
      mockedGhJson.mockResolvedValue([]);

      const result = await repoCommand(['list'], ctx);

      expect(result).toContain('count: 0');
    });

    it('shows truncation hint when result count equals default limit', async () => {
      // Default limit is 30
      const items = Array.from({ length: 30 }, (_, i) => ({
        name: `repo-${i}`, description: '', visibility: 'PUBLIC', primaryLanguage: null, stargazerCount: 0, updatedAt: '2024-01-01T00:00:00Z',
      }));
      mockedGhJson.mockResolvedValue(items);

      const result = await repoCommand(['list'], ctx);

      expect(result).toContain('showing first 30');
    });

    it('shows truncation hint when custom limit is hit', async () => {
      const items = Array.from({ length: 10 }, (_, i) => ({
        name: `repo-${i}`, description: '', visibility: 'PUBLIC', primaryLanguage: null, stargazerCount: 0, updatedAt: '2024-01-01T00:00:00Z',
      }));
      mockedGhJson.mockResolvedValue(items);

      const result = await repoCommand(['list', '--limit', '10'], ctx);

      expect(result).toContain('showing first 10');
    });
  });

  describe('clone', () => {
    it('clones a repo', async () => {
      mockedGhExec.mockResolvedValue('');

      const result = await repoCommand(['clone', 'octo/repo']);

      expect(result).toContain('clone');
      expect(result).toContain('ok');
      expect(mockedGhExec).toHaveBeenCalledWith(['repo', 'clone', 'octo/repo']);
    });

    it('throws when repo is missing', async () => {
      await expect(
        repoCommand(['clone']),
      ).rejects.toThrow(AxiError);
    });
  });
});
