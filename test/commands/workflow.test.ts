import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/gh.js', () => ({
  ghJson: vi.fn(),
  ghExec: vi.fn(),
  ghRaw: vi.fn(),
}));

import { ghJson } from '../../src/gh.js';
import { workflowCommand, WORKFLOW_HELP } from '../../src/commands/workflow.js';
import { AxiError } from '../../src/errors.js';
import type { RepoContext } from '../../src/context.js';

const mockedGhJson = vi.mocked(ghJson);

const ctx: RepoContext = { owner: 'octo', name: 'repo', nwo: 'octo/repo', source: 'flag' };

describe('workflowCommand', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('router', () => {
    it('returns help when --help is passed', async () => {
      const result = await workflowCommand(['--help']);
      expect(result).toBe(WORKFLOW_HELP);
    });

    it('returns help when no subcommand is given', async () => {
      const result = await workflowCommand([]);
      expect(result).toBe(WORKFLOW_HELP);
    });

    it('returns error for unknown subcommand', async () => {
      const result = await workflowCommand(['unknown']);
      expect(result).toContain('Unknown subcommand: unknown');
    });
  });

  describe('list', () => {
    it('returns list', async () => {
      mockedGhJson.mockResolvedValue([
        { id: 1, name: 'CI', state: 'active', path: '.github/workflows/ci.yml' },
        { id: 2, name: 'Deploy', state: 'active', path: '.github/workflows/deploy.yml' },
      ]);

      const result = await workflowCommand(['list'], ctx);

      expect(result).toContain('CI');
      expect(result).toContain('Deploy');
      expect(result).toContain('.github/workflows/ci.yml');
    });

    it('emits count line with number of workflows', async () => {
      mockedGhJson.mockResolvedValue([
        { id: 1, name: 'CI', state: 'active', path: '.github/workflows/ci.yml' },
        { id: 2, name: 'Deploy', state: 'active', path: '.github/workflows/deploy.yml' },
        { id: 3, name: 'Release', state: 'active', path: '.github/workflows/release.yml' },
      ]);

      const result = await workflowCommand(['list'], ctx);

      expect(result).toContain('count: 3');
    });

    it('emits count: 0 when no workflows exist', async () => {
      mockedGhJson.mockResolvedValue([]);

      const result = await workflowCommand(['list'], ctx);

      expect(result).toContain('count: 0');
    });

    it('shows truncation hint when result count equals limit', async () => {
      // Default limit is 20; create 20 items to hit the limit
      const items = Array.from({ length: 20 }, (_, i) => ({
        id: i + 1, name: `WF-${i + 1}`, state: 'active', path: `.github/workflows/wf${i + 1}.yml`,
      }));
      mockedGhJson.mockResolvedValue(items);

      const result = await workflowCommand(['list'], ctx);

      expect(result).toContain('showing first 20');
    });

    it('shows truncation hint when custom limit is hit', async () => {
      const items = Array.from({ length: 5 }, (_, i) => ({
        id: i + 1, name: `WF-${i + 1}`, state: 'active', path: `.github/workflows/wf${i + 1}.yml`,
      }));
      mockedGhJson.mockResolvedValue(items);

      const result = await workflowCommand(['list', '--limit', '5'], ctx);

      expect(result).toContain('showing first 5');
    });
  });

  describe('view', () => {
    it('finds by name', async () => {
      mockedGhJson.mockResolvedValue([
        { id: 1, name: 'CI', state: 'active', path: '.github/workflows/ci.yml' },
        { id: 2, name: 'Deploy', state: 'disabled_manually', path: '.github/workflows/deploy.yml' },
      ]);

      const result = await workflowCommand(['view', 'CI'], ctx);

      expect(result).toContain('CI');
      expect(result).toContain('active');
      expect(result).toContain('.github/workflows/ci.yml');
    });

    it('omits help suggestions from detail view', async () => {
      mockedGhJson.mockResolvedValue([
        { id: 1, name: 'CI', state: 'active', path: '.github/workflows/ci.yml' },
      ]);
      const result = await workflowCommand(['view', 'CI'], ctx);
      expect(result).not.toMatch(/^help\[/m);
    });

    it('throws when workflow not found', async () => {
      mockedGhJson.mockResolvedValue([
        { id: 1, name: 'CI', state: 'active', path: '.github/workflows/ci.yml' },
      ]);

      await expect(
        workflowCommand(['view', 'nonexistent'], ctx),
      ).rejects.toThrow(AxiError);
    });
  });
});
