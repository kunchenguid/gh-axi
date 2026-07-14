import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import {
  AxiError,
  installSessionStartHooks,
  resolvePortableHookCommand,
  type PortableHookCommandContext,
} from "axi-sdk-js";
import { renderHelp, renderOutput } from "../toon.js";

const HOOK_MARKER = "gh-axi";
const BINARY_NAME = "gh-axi";

export const SETUP_HELP = `usage: gh-axi setup hooks
Install or repair agent SessionStart hooks for gh-axi ambient context.

examples:
  gh-axi setup hooks
`;

export async function setupCommand(args: string[]): Promise<string> {
  if (args.length !== 1 || args[0] !== "hooks") {
    throw new AxiError("Unknown setup action", "VALIDATION_ERROR", [
      "Run `gh-axi setup hooks`",
    ]);
  }

  const { execPath, context } = resolveHookLauncher();
  const hookCommand = resolvePortableHookCommand(
    execPath,
    [BINARY_NAME],
    HOOK_MARKER,
    context,
  );
  if (hookCommand !== BINARY_NAME) {
    throw new AxiError(
      "Could not resolve a portable gh-axi hook command",
      "VALIDATION_ERROR",
      ["Install gh-axi globally and ensure it is on PATH"],
    );
  }

  const errors: string[] = [];
  installSessionStartHooks({
    marker: HOOK_MARKER,
    execPath,
    binaryNames: [BINARY_NAME],
    shouldInstall: () => true,
    onError: (message) => errors.push(message),
  });

  if (errors.length > 0) {
    throw new AxiError("Hook setup was incomplete", "UNKNOWN", errors);
  }

  return renderOutput([
    "hooks:\n  status: installed\n  integrations: Claude Code, Codex, OpenCode",
    renderHelp([
      "Restart your agent session to receive gh-axi ambient context",
    ]),
  ]);
}

function resolveHookLauncher(): {
  execPath: string;
  context: PortableHookCommandContext;
} {
  const rawPath = process.env.PATH ?? process.env.Path ?? "";
  const pathEntries = rawPath.split(delimiter).filter(Boolean);
  const pathExtensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")
      : [""];
  const context: PortableHookCommandContext = {
    pathEntries,
    pathExtensions,
    resolveRealPath: (path) => {
      try {
        if (!statSync(path).isFile()) {
          return undefined;
        }
        return realpathSync(path);
      } catch {
        return undefined;
      }
    },
  };

  for (const directory of pathEntries) {
    for (const extension of pathExtensions) {
      const candidate = join(directory, `${BINARY_NAME}${extension}`);
      try {
        accessSync(candidate, constants.X_OK);
      } catch {
        continue;
      }
      if (context.resolveRealPath(candidate)) {
        return { execPath: candidate, context };
      }
    }
  }

  throw new AxiError(
    "Could not find an installed gh-axi executable on PATH",
    "VALIDATION_ERROR",
    ["Run `npm install -g gh-axi`, then retry `gh-axi setup hooks`"],
  );
}
