import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/gh.js', () => ({
  ghJson: vi.fn(),
  ghExec: vi.fn(),
  ghRaw: vi.fn(),
}));

import { ghJson } from '../../src/gh.js';
import { sessionStartCommand } from '../../src/commands/home.js';
import type { RepoContext } from '../../src/context.js';

const mockedGhJson = vi.mocked(ghJson);

const ctx: RepoContext = { owner: 'octo', name: 'repo', nwo: 'octo/repo', source: 'git' };

describe('sessionStartCommand', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('includes repo name in output', async () => {
    mockedGhJson.mockResolvedValue([]);

    const result = await sessionStartCommand(ctx);

    expect(result).toContain('octo/repo');
  });

  it('does not include bin: or description: fields', async () => {
    mockedGhJson.mockResolvedValue([]);

    const result = await sessionStartCommand(ctx);

    expect(result).not.toContain('bin:');
    expect(result).not.toContain('description:');
  });

  it('does not include help suggestions', async () => {
    mockedGhJson.mockResolvedValue([]);

    const result = await sessionStartCommand(ctx);

    expect(result).not.toContain('help[');
    expect(result).not.toContain('help:');
  });

  it('includes issues and prs sections with data', async () => {
    mockedGhJson.mockImplementation(async (args: string[]) => {
      if (args[0] === 'issue') {
        return [
          { number: 1, title: 'Bug report' },
          { number: 2, title: 'Feature req' },
        ];
      }
      if (args[0] === 'pr') {
        return [
          { number: 10, title: 'Add feature' },
        ];
      }
      return [];
    });

    const result = await sessionStartCommand(ctx);

    expect(result).toContain('issues');
    expect(result).toContain('Bug report');
    expect(result).toContain('prs');
    expect(result).toContain('Add feature');
    expect(result).not.toContain('runs');
  });

  it('queries issues with limit 3', async () => {
    mockedGhJson.mockResolvedValue([]);

    await sessionStartCommand(ctx);

    const issueCalls = mockedGhJson.mock.calls.filter(
      (call) => (call[0] as string[])[0] === 'issue',
    );
    expect(issueCalls).toHaveLength(1);
    const issueArgs = issueCalls[0][0] as string[];
    expect(issueArgs).toContain('--limit');
    const limitIndex = issueArgs.indexOf('--limit');
    expect(issueArgs[limitIndex + 1]).toBe('3');
  });

  it('queries PRs with limit 3', async () => {
    mockedGhJson.mockResolvedValue([]);

    await sessionStartCommand(ctx);

    const prCalls = mockedGhJson.mock.calls.filter(
      (call) => (call[0] as string[])[0] === 'pr',
    );
    expect(prCalls).toHaveLength(1);
    const prArgs = prCalls[0][0] as string[];
    expect(prArgs).toContain('--limit');
    const limitIndex = prArgs.indexOf('--limit');
    expect(prArgs[limitIndex + 1]).toBe('3');
  });

  it('does not query runs', async () => {
    mockedGhJson.mockResolvedValue([]);

    await sessionStartCommand(ctx);

    const runCalls = mockedGhJson.mock.calls.filter(
      (call) => (call[0] as string[])[0] === 'run',
    );
    expect(runCalls).toHaveLength(0);
  });

  it('uses a compact issue schema (number and title only)', async () => {
    mockedGhJson.mockImplementation(async (args: string[]) => {
      if (args[0] === 'issue') {
        return [
          { number: 42, title: 'Fix login', state: 'OPEN', author: { login: 'alice' } },
        ];
      }
      return [];
    });

    const result = await sessionStartCommand(ctx);

    expect(result).toContain('42');
    expect(result).toContain('Fix login');
    expect(result).not.toContain('alice');
    expect(result).not.toContain('{number,title,state');
  });

  it('uses a compact PR schema (number and title only)', async () => {
    mockedGhJson.mockImplementation(async (args: string[]) => {
      if (args[0] === 'pr') {
        return [
          { number: 7, title: 'New widget', author: { login: 'dana' }, reviewDecision: 'APPROVED' },
        ];
      }
      return [];
    });

    const result = await sessionStartCommand(ctx);

    expect(result).toContain('7');
    expect(result).toContain('New widget');
    expect(result).not.toContain('dana');
    expect(result).not.toContain('approved');
  });

  it('handles API failures gracefully', async () => {
    mockedGhJson.mockRejectedValue(new Error('network error'));

    const result = await sessionStartCommand(ctx);

    expect(result).toContain('octo/repo');
  });

  it('is shorter than homeCommand output with same data', async () => {
    const mockData = async (args: string[]) => {
      if (args[0] === 'issue') {
        return [
          { number: 1, title: 'Bug report', state: 'OPEN', author: { login: 'alice' } },
          { number: 2, title: 'Feature req', state: 'OPEN', author: { login: 'bob' } },
        ];
      }
      if (args[0] === 'pr') {
        return [
          { number: 10, title: 'Add feature', author: { login: 'charlie' }, reviewDecision: 'APPROVED' },
        ];
      }
      return [];
    };

    const { homeCommand } = await import('../../src/commands/home.js');

    mockedGhJson.mockImplementation(mockData as typeof mockedGhJson);
    const sessionOutput = await sessionStartCommand(ctx);

    mockedGhJson.mockImplementation(mockData as typeof mockedGhJson);
    const homeOutput = await homeCommand([], ctx);

    expect(sessionOutput.length).toBeLessThan(homeOutput.length);
  });

  it('works without repo context (undefined)', async () => {
    mockedGhJson.mockResolvedValue([]);

    const result = await sessionStartCommand(undefined);

    expect(result).not.toContain('repo:');
    expect(result).toBeDefined();
  });

  it('runs both queries in parallel', async () => {
    mockedGhJson.mockResolvedValue([]);

    await sessionStartCommand(ctx);

    expect(mockedGhJson).toHaveBeenCalledTimes(2);
  });
});
