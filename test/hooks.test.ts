import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('node:fs');
vi.mock('node:os');

const mockedFs = vi.mocked(fs);
const mockedOs = vi.mocked(os);

// Import after mocking
import { ensureHooks } from '../src/hooks.js';

describe('ensureHooks', () => {
  const FAKE_HOME = '/home/testuser';
  const FAKE_EXE = '/usr/local/bin/gh-axi';
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let originalArgv1: string;

  beforeEach(() => {
    vi.resetAllMocks();
    mockedOs.homedir.mockReturnValue(FAKE_HOME);
    originalArgv1 = process.argv[1];
    process.argv[1] = FAKE_EXE;
    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    // Default: directories don't exist, files don't exist
    mockedFs.existsSync.mockReturnValue(false);
    mockedFs.readFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    mockedFs.writeFileSync.mockImplementation(() => {});
    mockedFs.mkdirSync.mockImplementation(() => '' as any);
  });

  afterEach(() => {
    process.argv[1] = originalArgv1;
    stderrSpy.mockRestore();
  });

  function getClaudeWritten(): any {
    const call = (mockedFs.writeFileSync as any).mock.calls.find(
      (c: any[]) => c[0] === path.join(FAKE_HOME, '.claude', 'settings.json'),
    );
    return call ? JSON.parse(call[1]) : null;
  }

  describe('Claude Code hooks (~/.claude/settings.json)', () => {
    it('creates settings.json with SessionStart hook when ~/.claude dir exists but no settings file', () => {
      mockedFs.existsSync.mockImplementation((p) => {
        if (p === path.join(FAKE_HOME, '.claude')) return true;
        return false;
      });

      ensureHooks();

      const written = getClaudeWritten();
      expect(written).not.toBeNull();
      expect(written.hooks.SessionStart).toBeInstanceOf(Array);
      expect(written.hooks.SessionStart.length).toBe(1);

      const block = written.hooks.SessionStart[0];
      expect(block.matcher).toBe('');
      expect(block.hooks).toBeInstanceOf(Array);
      expect(block.hooks[0].type).toBe('command');
      expect(block.hooks[0].command).toBe(`${FAKE_EXE} --session-start`);
      expect(block.hooks[0].timeout).toBe(10);
    });

    it('adds hook to existing settings.json that has no hooks section', () => {
      mockedFs.existsSync.mockImplementation((p) => {
        if (p === path.join(FAKE_HOME, '.claude')) return true;
        if (p === path.join(FAKE_HOME, '.claude', 'settings.json')) return true;
        return false;
      });
      mockedFs.readFileSync.mockImplementation((p) => {
        if (p === path.join(FAKE_HOME, '.claude', 'settings.json')) {
          return JSON.stringify({ permissions: {} });
        }
        throw new Error('ENOENT');
      });

      ensureHooks();

      const written = getClaudeWritten();
      expect(written.permissions).toEqual({});
      expect(written.hooks.SessionStart[0].hooks[0].command).toBe(`${FAKE_EXE} --session-start`);
    });

    it('updates hook when exe path is stale', () => {
      const staleExe = '/old/path/gh-axi';
      const existingSettings = {
        hooks: {
          SessionStart: [
            {
              matcher: '',
              hooks: [
                { type: 'command', command: `${staleExe} --session-start`, timeout: 10 },
              ],
            },
          ],
        },
      };

      mockedFs.existsSync.mockImplementation((p) => {
        if (p === path.join(FAKE_HOME, '.claude')) return true;
        if (p === path.join(FAKE_HOME, '.claude', 'settings.json')) return true;
        return false;
      });
      mockedFs.readFileSync.mockImplementation((p) => {
        if (p === path.join(FAKE_HOME, '.claude', 'settings.json')) {
          return JSON.stringify(existingSettings);
        }
        throw new Error('ENOENT');
      });

      ensureHooks();

      const written = getClaudeWritten();
      expect(written.hooks.SessionStart[0].hooks[0].command).toBe(`${FAKE_EXE} --session-start`);
      expect(written.hooks.SessionStart[0].hooks[0].command).not.toContain(staleExe);
    });

    it('is a no-op when hook already has the correct exe path', () => {
      const existingSettings = {
        hooks: {
          SessionStart: [
            {
              matcher: '',
              hooks: [
                { type: 'command', command: `${FAKE_EXE} --session-start`, timeout: 10 },
              ],
            },
          ],
        },
      };

      mockedFs.existsSync.mockImplementation((p) => {
        if (p === path.join(FAKE_HOME, '.claude')) return true;
        if (p === path.join(FAKE_HOME, '.claude', 'settings.json')) return true;
        return false;
      });
      mockedFs.readFileSync.mockImplementation((p) => {
        if (p === path.join(FAKE_HOME, '.claude', 'settings.json')) {
          return JSON.stringify(existingSettings);
        }
        throw new Error('ENOENT');
      });

      ensureHooks();

      expect(getClaudeWritten()).toBeNull();
    });

    it('skips Claude hooks when ~/.claude directory does not exist', () => {
      mockedFs.existsSync.mockReturnValue(false);

      ensureHooks();

      expect(getClaudeWritten()).toBeNull();
    });

    it('preserves other SessionStart matcher blocks when adding gh-axi hook', () => {
      const existingSettings = {
        hooks: {
          SessionStart: [
            {
              matcher: '',
              hooks: [
                { type: 'command', command: '/some/other/tool' },
              ],
            },
          ],
        },
      };

      mockedFs.existsSync.mockImplementation((p) => {
        if (p === path.join(FAKE_HOME, '.claude')) return true;
        if (p === path.join(FAKE_HOME, '.claude', 'settings.json')) return true;
        return false;
      });
      mockedFs.readFileSync.mockImplementation((p) => {
        if (p === path.join(FAKE_HOME, '.claude', 'settings.json')) {
          return JSON.stringify(existingSettings);
        }
        throw new Error('ENOENT');
      });

      ensureHooks();

      const written = getClaudeWritten();
      expect(written.hooks.SessionStart.length).toBe(2);
      expect(written.hooks.SessionStart[0].hooks[0].command).toBe('/some/other/tool');
      expect(written.hooks.SessionStart[1].hooks[0].command).toBe(`${FAKE_EXE} --session-start`);
    });
  });

  describe('Codex hooks (~/.codex/hooks.json)', () => {
    it('creates hooks.json with hook when ~/.codex dir exists but no hooks file', () => {
      mockedFs.existsSync.mockImplementation((p) => {
        if (p === path.join(FAKE_HOME, '.codex')) return true;
        return false;
      });

      ensureHooks();

      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        path.join(FAKE_HOME, '.codex', 'hooks.json'),
        expect.any(String),
        'utf-8',
      );

      const written = JSON.parse(
        (mockedFs.writeFileSync as any).mock.calls.find(
          (c: any[]) => c[0] === path.join(FAKE_HOME, '.codex', 'hooks.json'),
        )[1],
      );
      expect(written.hooks.session_start).toBeInstanceOf(Array);
      expect(written.hooks.session_start[0].command).toContain(FAKE_EXE);
    });

    it('updates hook when exe path is stale in Codex config', () => {
      const staleExe = '/old/path/gh-axi';
      const existingHooks = {
        hooks: {
          session_start: [
            { command: `${staleExe}` },
          ],
        },
      };

      mockedFs.existsSync.mockImplementation((p) => {
        if (p === path.join(FAKE_HOME, '.codex')) return true;
        if (p === path.join(FAKE_HOME, '.codex', 'hooks.json')) return true;
        return false;
      });
      mockedFs.readFileSync.mockImplementation((p) => {
        if (p === path.join(FAKE_HOME, '.codex', 'hooks.json')) {
          return JSON.stringify(existingHooks);
        }
        throw new Error('ENOENT');
      });

      ensureHooks();

      const written = JSON.parse(
        (mockedFs.writeFileSync as any).mock.calls.find(
          (c: any[]) => c[0] === path.join(FAKE_HOME, '.codex', 'hooks.json'),
        )[1],
      );
      expect(written.hooks.session_start[0].command).toContain(FAKE_EXE);
      expect(written.hooks.session_start[0].command).not.toContain(staleExe);
    });

    it('is a no-op when Codex hook already has correct exe path', () => {
      const existingHooks = {
        hooks: {
          session_start: [
            { command: `${FAKE_EXE}` },
          ],
        },
      };

      mockedFs.existsSync.mockImplementation((p) => {
        if (p === path.join(FAKE_HOME, '.codex')) return true;
        if (p === path.join(FAKE_HOME, '.codex', 'hooks.json')) return true;
        return false;
      });
      mockedFs.readFileSync.mockImplementation((p) => {
        if (p === path.join(FAKE_HOME, '.codex', 'hooks.json')) {
          return JSON.stringify(existingHooks);
        }
        throw new Error('ENOENT');
      });

      ensureHooks();

      const codexWrites = (mockedFs.writeFileSync as any).mock.calls.filter(
        (c: any[]) => c[0] === path.join(FAKE_HOME, '.codex', 'hooks.json'),
      );
      expect(codexWrites.length).toBe(0);
    });

    it('skips Codex hooks when ~/.codex directory does not exist', () => {
      mockedFs.existsSync.mockReturnValue(false);

      ensureHooks();

      const codexWrites = (mockedFs.writeFileSync as any).mock.calls.filter(
        (c: any[]) => (c[0] as string).includes('.codex'),
      );
      expect(codexWrites.length).toBe(0);
    });
  });

  describe('error handling', () => {
    it('never throws even when fs operations fail', () => {
      mockedFs.existsSync.mockImplementation(() => {
        throw new Error('permission denied');
      });

      expect(() => ensureHooks()).not.toThrow();
    });

    it('logs to stderr when an error occurs', () => {
      mockedFs.existsSync.mockImplementation(() => {
        throw new Error('permission denied');
      });

      ensureHooks();

      expect(stderrSpy).toHaveBeenCalled();
    });

    it('handles corrupt JSON in settings file gracefully', () => {
      mockedFs.existsSync.mockImplementation((p) => {
        if (p === path.join(FAKE_HOME, '.claude')) return true;
        if (p === path.join(FAKE_HOME, '.claude', 'settings.json')) return true;
        return false;
      });
      mockedFs.readFileSync.mockImplementation((p) => {
        if (p === path.join(FAKE_HOME, '.claude', 'settings.json')) {
          return '{ invalid json !!!';
        }
        throw new Error('ENOENT');
      });

      expect(() => ensureHooks()).not.toThrow();
    });

    it('still installs Codex hook when Claude hook fails', () => {
      let claudeWriteAttempted = false;
      mockedFs.existsSync.mockImplementation((p) => {
        if (p === path.join(FAKE_HOME, '.claude')) return true;
        if (p === path.join(FAKE_HOME, '.codex')) return true;
        return false;
      });
      mockedFs.readFileSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });
      mockedFs.writeFileSync.mockImplementation((p) => {
        if ((p as string).includes('.claude')) {
          claudeWriteAttempted = true;
          throw new Error('Claude write failed');
        }
      });

      ensureHooks();

      expect(claudeWriteAttempted).toBe(true);
      const codexWrites = (mockedFs.writeFileSync as any).mock.calls.filter(
        (c: any[]) => (c[0] as string).includes('.codex'),
      );
      expect(codexWrites.length).toBe(1);
    });
  });

  describe('executable path resolution', () => {
    it('uses process.argv[1] as the executable path', () => {
      process.argv[1] = '/custom/path/to/gh-axi';

      mockedFs.existsSync.mockImplementation((p) => {
        if (p === path.join(FAKE_HOME, '.claude')) return true;
        return false;
      });

      ensureHooks();

      const written = getClaudeWritten();
      expect(written.hooks.SessionStart[0].hooks[0].command).toContain('/custom/path/to/gh-axi');
    });
  });
});
