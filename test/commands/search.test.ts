import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/gh.js', () => ({
  ghJson: vi.fn(),
  ghExec: vi.fn(),
  ghRaw: vi.fn(),
}));

import { ghJson } from '../../src/gh.js';
import { searchCommand, SEARCH_HELP } from '../../src/commands/search.js';
import { AxiError } from '../../src/errors.js';
import type { RepoContext } from '../../src/context.js';

const mockedGhJson = vi.mocked(ghJson);

const ctx: RepoContext = { owner: 'octo', name: 'repo', nwo: 'octo/repo', source: 'flag' };

describe('searchCommand', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('router', () => {
    it('returns help when --help is passed', async () => {
      const result = await searchCommand(['--help']);
      expect(result).toBe(SEARCH_HELP);
    });

    it('returns help when no subcommand is given', async () => {
      const result = await searchCommand([]);
      expect(result).toBe(SEARCH_HELP);
    });

    it('returns error for unknown type', async () => {
      const result = await searchCommand(['unknown', 'query']);
      expect(result).toContain('Unknown search type: unknown');
    });
  });

  describe('searchIssues', () => {
    it('requires query', async () => {
      await expect(
        searchCommand(['issues']),
      ).rejects.toThrow(AxiError);
    });

    it('returns results with count', async () => {
      mockedGhJson.mockResolvedValue([
        { number: 1, title: 'Bug', repository: { nameWithOwner: 'octo/repo' }, state: 'OPEN', author: { login: 'alice' }, labels: [], createdAt: '2024-01-01T00:00:00Z' },
        { number: 2, title: 'Feature', repository: { nameWithOwner: 'octo/repo' }, state: 'CLOSED', author: { login: 'bob' }, labels: [], createdAt: '2024-01-02T00:00:00Z' },
      ]);

      const result = await searchCommand(['issues', 'test query'], ctx);

      expect(result).toContain('count: 2');
      expect(result).toContain('Bug');
      expect(result).toContain('Feature');
    });
  });

  describe('searchRepos', () => {
    it('returns results', async () => {
      mockedGhJson.mockResolvedValue([
        { fullName: 'octo/repo', description: 'A test repo', stargazersCount: 100, forksCount: 10, language: 'TypeScript', updatedAt: '2024-01-01T00:00:00Z' },
      ]);

      const result = await searchCommand(['repos', 'typescript'], ctx);

      expect(result).toContain('octo/repo');
      expect(result).toContain('A test repo');
    });

    it('emits count line', async () => {
      mockedGhJson.mockResolvedValue([
        { fullName: 'octo/repo1', description: '', stargazersCount: 10, forksCount: 1, language: 'TypeScript', updatedAt: '2024-01-01T00:00:00Z' },
        { fullName: 'octo/repo2', description: '', stargazersCount: 5, forksCount: 0, language: 'Go', updatedAt: '2024-01-02T00:00:00Z' },
      ]);

      const result = await searchCommand(['repos', 'test'], ctx);

      expect(result).toContain('count: 2');
    });

    it('shows display-limited hint when results exceed display limit', async () => {
      // DISPLAY_LIMIT is 30; create 35 results
      const items = Array.from({ length: 35 }, (_, i) => ({
        fullName: `octo/repo-${i}`, description: '', stargazersCount: 0, forksCount: 0, language: null, updatedAt: '2024-01-01T00:00:00Z',
      }));
      mockedGhJson.mockResolvedValue(items);

      const result = await searchCommand(['repos', 'test'], ctx);

      expect(result).toContain('count: 35');
      expect(result).toContain('showing first 30');
    });

    it('shows API limit hint when result count equals search limit', async () => {
      // Default search limit is 1000
      const items = Array.from({ length: 1000 }, (_, i) => ({
        fullName: `octo/repo-${i}`, description: '', stargazersCount: 0, forksCount: 0, language: null, updatedAt: '2024-01-01T00:00:00Z',
      }));
      mockedGhJson.mockResolvedValue(items);

      const result = await searchCommand(['repos', 'test'], ctx);

      expect(result).toContain('1000+');
    });
  });

  describe('searchCommits', () => {
    it('uses repo context when no explicit --repo flag is passed', async () => {
      mockedGhJson.mockResolvedValue([]);

      await searchCommand(['commits', 'fix'], ctx);

      expect(mockedGhJson).toHaveBeenCalledWith(
        expect.arrayContaining(['--repo', 'octo/repo']),
      );
    });

    it('emits count line', async () => {
      mockedGhJson.mockResolvedValue([
        { sha: 'abc123', commit: { message: 'fix bug', author: { date: '2024-01-01T00:00:00Z' } }, repository: { fullName: 'octo/repo' }, author: { login: 'alice' } },
      ]);

      const result = await searchCommand(['commits', 'fix'], ctx);

      expect(result).toContain('count: 1');
    });

    it('shows display-limited hint when results exceed display limit', async () => {
      const items = Array.from({ length: 35 }, (_, i) => ({
        sha: `abc${i}`, commit: { message: `commit ${i}`, author: { date: '2024-01-01T00:00:00Z' } }, repository: { fullName: 'octo/repo' }, author: { login: 'alice' },
      }));
      mockedGhJson.mockResolvedValue(items);

      const result = await searchCommand(['commits', 'fix'], ctx);

      expect(result).toContain('count: 35');
      expect(result).toContain('showing first 30');
    });

    it('shows API limit hint when result count equals search limit', async () => {
      const items = Array.from({ length: 1000 }, (_, i) => ({
        sha: `abc${i}`, commit: { message: `commit ${i}`, author: { date: '2024-01-01T00:00:00Z' } }, repository: { fullName: 'octo/repo' }, author: { login: 'alice' },
      }));
      mockedGhJson.mockResolvedValue(items);

      const result = await searchCommand(['commits', 'fix'], ctx);

      expect(result).toContain('1000+');
    });
  });

  describe('searchCode', () => {
    it('uses repo context when no explicit --repo flag is passed', async () => {
      mockedGhJson.mockResolvedValue([]);

      await searchCommand(['code', 'function'], ctx);

      expect(mockedGhJson).toHaveBeenCalledWith(
        expect.arrayContaining(['--repo', 'octo/repo']),
      );
    });

    it('emits count line', async () => {
      mockedGhJson.mockResolvedValue([
        { path: 'src/main.ts', repository: { fullName: 'octo/repo' }, textMatches: [{ type: 'FileContent' }] },
        { path: 'src/utils.ts', repository: { fullName: 'octo/repo' }, textMatches: [{ type: 'FileContent' }] },
      ]);

      const result = await searchCommand(['code', 'function'], ctx);

      expect(result).toContain('count: 2');
    });

    it('shows display-limited hint when results exceed display limit', async () => {
      const items = Array.from({ length: 35 }, (_, i) => ({
        path: `src/file${i}.ts`, repository: { fullName: 'octo/repo' }, textMatches: [{ type: 'FileContent' }],
      }));
      mockedGhJson.mockResolvedValue(items);

      const result = await searchCommand(['code', 'function'], ctx);

      expect(result).toContain('count: 35');
      expect(result).toContain('showing first 30');
    });

    it('shows API limit hint when result count equals search limit', async () => {
      const items = Array.from({ length: 1000 }, (_, i) => ({
        path: `src/file${i}.ts`, repository: { fullName: 'octo/repo' }, textMatches: [{ type: 'FileContent' }],
      }));
      mockedGhJson.mockResolvedValue(items);

      const result = await searchCommand(['code', 'function'], ctx);

      expect(result).toContain('1000+');
    });
  });
});
