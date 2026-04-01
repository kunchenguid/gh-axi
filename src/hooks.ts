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
  let changed = false;
  const hookCommand = `${exePath} --session-start`;

  // Migrate our legacy lowercase key if present.
  if (Array.isArray(config.hooks.session_start)) {
    const filteredLegacyHooks = config.hooks.session_start.filter(
      (h: any) => !(typeof h.command === 'string' && h.command.includes(HOOK_ID)),
    );

    if (filteredLegacyHooks.length !== config.hooks.session_start.length) {
      changed = true;
    }

    if (filteredLegacyHooks.length > 0) {
      config.hooks.session_start = filteredLegacyHooks;
    } else {
      delete config.hooks.session_start;
    }
  }

  if (!Array.isArray(config.hooks.SessionStart)) {
    config.hooks.SessionStart = [];
  }

  const matcherBlocks: any[] = config.hooks.SessionStart;
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
    const existingHook = matcherBlocks[existingIdx].hooks?.find(
      (h: any) => typeof h.command === 'string' && h.command.includes(HOOK_ID),
    );
    if (
      existingHook?.command === hookCommand &&
      matcherBlocks[existingIdx]?.matcher === '' &&
      existingHook?.type === 'command'
    ) {
      if (!changed) return; // no-op
    } else {
      matcherBlocks[existingIdx] = matcherBlock;
      changed = true;
    }
  } else {
    matcherBlocks.push(matcherBlock);
    changed = true;
  }

  if (!changed) return;

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
