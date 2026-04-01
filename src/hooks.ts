/**
 * Hook self-install and self-heal for Claude Code and Codex.
 * Ensures ambient context hooks are installed idempotently.
 * Failures are non-fatal — errors log to stderr and never throw.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Marker used to identify our hook entries in config files. */
const HOOK_ID = "gh-axi";

type HookCommand = {
  type?: string;
  command?: string;
  timeout?: number;
};

type MatcherBlock = {
  matcher?: string | null;
  hooks?: HookCommand[];
};

type HookCollection = {
  SessionStart?: MatcherBlock[];
  session_start?: HookCommand[];
};

type HookConfig = {
  hooks?: HookCollection;
  [key: string]: unknown;
};

function getExePath(): string {
  return process.argv[1];
}

function ensureHookCollection(config: HookConfig): HookCollection {
  if (!config.hooks) {
    config.hooks = {};
  }

  return config.hooks;
}

function ensureSessionStartBlocks(hooks: HookCollection): MatcherBlock[] {
  if (!Array.isArray(hooks.SessionStart)) {
    hooks.SessionStart = [];
  }

  return hooks.SessionStart;
}

function isManagedHook(hook: HookCommand | undefined): boolean {
  return typeof hook?.command === "string" && hook.command.includes(HOOK_ID);
}

function createMatcherBlock(command: string): MatcherBlock {
  return {
    matcher: "",
    hooks: [
      {
        type: "command",
        command,
        timeout: 10,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Claude Code hooks: ~/.claude/settings.json
// ---------------------------------------------------------------------------

function ensureClaudeHook(exePath: string): void {
  const claudeDir = join(homedir(), ".claude");
  if (!existsSync(claudeDir)) return;

  const settingsPath = join(claudeDir, "settings.json");
  let settings: HookConfig = {};

  if (existsSync(settingsPath)) {
    const raw = readFileSync(settingsPath, "utf-8");
    settings = JSON.parse(raw) as HookConfig;
  }

  const matcherBlocks = ensureSessionStartBlocks(
    ensureHookCollection(settings),
  );
  const hookCommand = `${exePath} --session-start`;

  // Find existing gh-axi matcher block (by looking for gh-axi in any nested hook command)
  const existingIdx = matcherBlocks.findIndex(
    (block) => Array.isArray(block.hooks) && block.hooks.some(isManagedHook),
  );

  const matcherBlock = createMatcherBlock(hookCommand);

  if (existingIdx >= 0) {
    // Check if command is already correct
    const existingHook = matcherBlocks[existingIdx].hooks?.find(isManagedHook);
    if (existingHook?.command === hookCommand) {
      return; // no-op
    }
    // Repair stale path
    matcherBlocks[existingIdx] = matcherBlock;
  } else {
    matcherBlocks.push(matcherBlock);
  }

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Codex hooks: ~/.codex/hooks.json
// Uses `hooks.SessionStart` matcher blocks and migrates legacy
// `hooks.session_start` entries when present.
// ---------------------------------------------------------------------------

function ensureCodexHook(exePath: string): void {
  const codexDir = join(homedir(), ".codex");
  if (!existsSync(codexDir)) return;

  const hooksPath = join(codexDir, "hooks.json");
  let config: HookConfig = {};

  if (existsSync(hooksPath)) {
    const raw = readFileSync(hooksPath, "utf-8");
    config = JSON.parse(raw) as HookConfig;
  }

  const hooks = ensureHookCollection(config);
  let changed = false;
  const hookCommand = `${exePath} --session-start`;

  // Migrate our legacy lowercase key if present.
  if (Array.isArray(hooks.session_start)) {
    const filteredLegacyHooks = hooks.session_start.filter(
      (hook) => !isManagedHook(hook),
    );

    if (filteredLegacyHooks.length !== hooks.session_start.length) {
      changed = true;
    }

    if (filteredLegacyHooks.length > 0) {
      hooks.session_start = filteredLegacyHooks;
    } else {
      delete hooks.session_start;
    }
  }

  const matcherBlocks = ensureSessionStartBlocks(hooks);
  const existingIdx = matcherBlocks.findIndex(
    (block) => Array.isArray(block.hooks) && block.hooks.some(isManagedHook),
  );

  const matcherBlock = createMatcherBlock(hookCommand);

  if (existingIdx >= 0) {
    const existingBlock = matcherBlocks[existingIdx];
    const existingHook = existingBlock.hooks?.find(isManagedHook);
    const matcher = existingBlock?.matcher;
    const matcherIsMatchAll =
      matcher === "" || matcher === "*" || matcher == null;
    if (
      existingHook?.command === hookCommand &&
      matcherIsMatchAll &&
      existingHook?.type === "command"
    ) {
      if (!changed) return; // no-op
    } else if (existingHook) {
      existingHook.command = hookCommand;
      existingHook.type = "command";
      changed = true;
    } else {
      if (!Array.isArray(existingBlock.hooks)) {
        existingBlock.hooks = [];
      }
      existingBlock.hooks.push({
        type: "command",
        command: hookCommand,
        timeout: 10,
      });
      changed = true;
    }
  } else {
    matcherBlocks.push(matcherBlock);
    changed = true;
  }

  if (!changed) return;

  writeFileSync(hooksPath, JSON.stringify(config, null, 2), "utf-8");
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
