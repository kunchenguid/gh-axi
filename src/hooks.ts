/**
 * Hook self-install and self-heal for Claude Code and Codex.
 * Ensures ambient context hooks are installed idempotently.
 * Failures are non-fatal — errors log to stderr and never throw.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Marker used to identify our hook entries in config files. */
const HOOK_ID = 'gh-axi';

function getExePath(): string {
  return process.argv[1];
}

// ---------------------------------------------------------------------------
// Claude Code hooks: ~/.claude/settings.json
// ---------------------------------------------------------------------------

function ensureClaudeHook(exePath: string): void {
  const claudeDir = join(homedir(), '.claude');
  if (!existsSync(claudeDir)) return;

  const settingsPath = join(claudeDir, 'settings.json');
  let settings: Record<string, any> = {};

  if (existsSync(settingsPath)) {
    const raw = readFileSync(settingsPath, 'utf-8');
    settings = JSON.parse(raw);
  }

  if (!settings.hooks) {
    settings.hooks = {};
  }
  if (!Array.isArray(settings.hooks.SessionStart)) {
    settings.hooks.SessionStart = [];
  }

  const matcherBlocks: any[] = settings.hooks.SessionStart;
  const hookCommand = `${exePath} --session-start`;

  // Find existing gh-axi matcher block (by looking for gh-axi in any nested hook command)
  const existingIdx = matcherBlocks.findIndex(
    (block: any) =>
      Array.isArray(block.hooks) &&
      block.hooks.some((h: any) => typeof h.command === 'string' && h.command.includes(HOOK_ID)),
  );

  const matcherBlock = {
    matcher: '',
    hooks: [
      {
        type: 'command' as const,
        command: hookCommand,
        timeout: 10,
      },
    ],
  };

  if (existingIdx >= 0) {
    // Check if command is already correct
    const existingHook = matcherBlocks[existingIdx].hooks?.find(
      (h: any) => typeof h.command === 'string' && h.command.includes(HOOK_ID),
    );
    if (existingHook?.command === hookCommand) {
      return; // no-op
    }
    // Repair stale path
    matcherBlocks[existingIdx] = matcherBlock;
  } else {
    matcherBlocks.push(matcherBlock);
  }

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Codex hooks: ~/.codex/hooks.json
// ---------------------------------------------------------------------------

function ensureCodexHook(exePath: string): void {
  const codexDir = join(homedir(), '.codex');
  if (!existsSync(codexDir)) return;

  const hooksPath = join(codexDir, 'hooks.json');
  let config: Record<string, any> = {};

  if (existsSync(hooksPath)) {
    const raw = readFileSync(hooksPath, 'utf-8');
    config = JSON.parse(raw);
  }

  if (!config.hooks) {
    config.hooks = {};
  }
  if (!Array.isArray(config.hooks.session_start)) {
    config.hooks.session_start = [];
  }

  const hooks: any[] = config.hooks.session_start;

  const existingIdx = hooks.findIndex(
    (h: any) => typeof h.command === 'string' && h.command.includes(HOOK_ID),
  );

  const hookEntry = {
    command: exePath,
  };

  if (existingIdx >= 0) {
    if (hooks[existingIdx].command === exePath) {
      return; // no-op
    }
    hooks[existingIdx] = hookEntry;
  } else {
    hooks.push(hookEntry);
  }

  writeFileSync(hooksPath, JSON.stringify(config, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ensures hooks are installed idempotently for Claude Code and Codex.
 * Never throws — catches all errors and logs to stderr.
 * Each hook target is independent; failure in one does not block the other.
 */
export function ensureHooks(): void {
  const exePath = getExePath();

  try {
    ensureClaudeHook(exePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`gh-axi: Claude hook install skipped: ${msg}\n`);
  }

  try {
    ensureCodexHook(exePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`gh-axi: Codex hook install skipped: ${msg}\n`);
  }
}
