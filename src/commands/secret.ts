import { encode } from "@toon-format/toon";
import type { RepoContext } from "../context.js";
import { ghJson, ghExec, ghExecWithStdin } from "../gh.js";
import { AxiError } from "../errors.js";
import {
  field,
  relativeTime,
  renderList,
  renderHelp,
  renderOutput,
  renderError,
  type FieldDef,
} from "../toon.js";
import { getSuggestions } from "../suggestions.js";
import { resolveValue } from "../secretValue.js";

export const SECRET_HELP = `usage: gh-axi secret <subcommand> [flags]
subcommands[3]:
  list, set <name>, delete <name>
flags[1]:
  --env/-e <environment> (all subcommands): scope to a deployment environment
flags{set}:
  value is read only from piped stdin; --body/-b is not accepted for secrets
values are never printed: \`list\` only exposes name and update time, matching \`gh secret list\`
scope: repository (default) or --env <environment>; other gh scopes (--org/--user/--app) are rejected, not silently ignored
examples:
  gh-axi secret list
  gh-axi secret list --env production
  echo -n "sk-..." | gh-axi secret set OPENAI_API_KEY
  echo -n "$(cat cert.p12 | base64)" | gh-axi secret set CSC_LINK --env production
  gh-axi secret delete OPENAI_API_KEY --env production`;

const listSchema: FieldDef[] = [
  field("name"),
  relativeTime("updatedAt", "updated"),
];

type SecretSub = "list" | "set" | "delete";

function usageFor(sub: SecretSub): string {
  switch (sub) {
    case "list":
      return "gh-axi secret list [--env <environment>]";
    case "set":
      return "gh-axi secret set <name> [--env <environment>]";
    case "delete":
      return "gh-axi secret delete <name> [--env <environment>]";
  }
}

// gh secret's non-repo scope flags. Only --env is exposed by gh-axi; the rest
// are surfaced as explicit errors so an unsupported scope fails loudly instead
// of being silently dropped back to repo scope (the historical bug). --env-file
// is included because it is an alternate secret-value channel that would bypass
// the stdin-only guarantee.
const UNSUPPORTED_SCOPE_FLAGS: Record<string, string> = {
  "--org": "--org",
  "-o": "--org",
  "--user": "--user",
  "-u": "--user",
  "--app": "--app",
  "-a": "--app",
  "--env-file": "--env-file",
  "-f": "--env-file",
};

function matchUnsupportedScopeFlag(tok: string): string | undefined {
  for (const [flag, canonical] of Object.entries(UNSUPPORTED_SCOPE_FLAGS)) {
    if (tok === flag || tok.startsWith(`${flag}=`)) {
      return canonical;
    }
  }
  return undefined;
}

interface ParsedScope {
  /** Positional (non-flag) tokens, with the --env value removed. */
  positionals: string[];
  /** Args appended to the upstream gh invocation, e.g. ["--env", "prod"] or []. */
  scopeArgs: string[];
}

/**
 * Resolve the environment scope for a `gh secret` subcommand and reject any
 * malformed, conflicting, or unsupported scope flag loudly. `tokens` must be
 * the subcommand's own tokens (repo/host context flags are already stripped
 * upstream in cli.ts). Secret values never reach here - `set`'s stdin-only
 * value is read separately - and unknown flags are echoed by name only (never
 * an attached `=value`), so no value can leak into an error message.
 */
function resolveScope(tokens: string[], sub: SecretSub): ParsedScope {
  const positionals: string[] = [];
  let env: string | undefined;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    if (!tok.startsWith("-")) {
      positionals.push(tok);
      continue;
    }

    // --env / -e (space form)
    if (tok === "--env" || tok === "-e") {
      const val = tokens[i + 1];
      if (val === undefined || val.length === 0 || val.startsWith("-")) {
        throw malformedEnvError(sub);
      }
      if (env !== undefined) throw conflictingEnvError(sub);
      env = val;
      i++;
      continue;
    }

    // --env=VALUE / -e=VALUE (equals form)
    if (tok.startsWith("--env=") || tok.startsWith("-e=")) {
      const val = tok.slice(tok.indexOf("=") + 1);
      if (val.length === 0) throw malformedEnvError(sub);
      if (env !== undefined) throw conflictingEnvError(sub);
      env = val;
      continue;
    }

    // Known-but-unsupported scope flags: fail loudly with a scope-aware hint.
    const unsupported = matchUnsupportedScopeFlag(tok);
    if (unsupported) throw unsupportedScopeError(unsupported, sub);

    // Any other flag: unknown; fail loudly instead of silently dropping it.
    throw unknownFlagError(tok, sub);
  }

  return {
    positionals,
    scopeArgs: env !== undefined ? ["--env", env] : [],
  };
}

function malformedEnvError(sub: SecretSub): AxiError {
  return new AxiError(
    "--env requires an environment name",
    "VALIDATION_ERROR",
    [usageFor(sub)],
  );
}

function conflictingEnvError(sub: SecretSub): AxiError {
  return new AxiError(
    "conflicting --env flags: specify a single environment",
    "VALIDATION_ERROR",
    [usageFor(sub)],
  );
}

function unsupportedScopeError(flag: string, sub: SecretSub): AxiError {
  return new AxiError(
    `gh-axi secret supports only repository scope and --env (environment) scope; ${flag} is not supported`,
    "VALIDATION_ERROR",
    [usageFor(sub)],
  );
}

function unknownFlagError(tok: string, sub: SecretSub): AxiError {
  // Echo the flag name only, never an attached `=value`, so a value cannot leak.
  const flagName = tok.split("=", 1)[0];
  return new AxiError(
    `unknown flag for gh-axi secret ${sub}: ${flagName}`,
    "VALIDATION_ERROR",
    [usageFor(sub), "gh-axi secret --help"],
  );
}

function hasBodyFlag(args: string[]): boolean {
  return args.some(
    (arg) =>
      arg === "--body" ||
      arg.startsWith("--body=") ||
      arg === "-b" ||
      arg.startsWith("-b="),
  );
}

async function listSecrets(args: string[], ctx?: RepoContext): Promise<string> {
  const { scopeArgs } = resolveScope(args.slice(1), "list");
  const secrets = await ghJson<Record<string, unknown>[]>(
    ["secret", "list", "--json", "name,updatedAt", ...scopeArgs],
    ctx,
  );
  const isEmpty = secrets.length === 0;

  const suggestions = getSuggestions({
    domain: "secret",
    action: "list",
    isEmpty,
    repo: ctx,
  });
  return renderOutput([
    `count: ${secrets.length}`,
    renderList("secrets", secrets, listSchema),
    renderHelp(suggestions),
  ]);
}

async function setSecret(args: string[], ctx?: RepoContext): Promise<string> {
  const remaining = args.slice(1);
  if (hasBodyFlag(remaining)) {
    throw new AxiError(
      "Secret values must be piped via stdin; --body/-b is not accepted because flags are visible in process argv",
      "VALIDATION_ERROR",
      [`echo -n "<value>" | gh-axi secret set <name>`],
    );
  }

  const { positionals, scopeArgs } = resolveScope(remaining, "set");
  const name = positionals[0];
  if (!name) {
    throw new AxiError(
      "Secret name is required: gh-axi secret set <name>",
      "VALIDATION_ERROR",
    );
  }

  const value = await resolveValue(undefined, "secret");
  await ghExecWithStdin(["secret", "set", name, ...scopeArgs], value, ctx);

  const suggestions = getSuggestions({
    domain: "secret",
    action: "set",
    id: name,
    repo: ctx,
  });
  return renderOutput([
    encode({ set: "ok", secret: name }),
    renderHelp(suggestions),
  ]);
}

async function deleteSecret(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const { positionals, scopeArgs } = resolveScope(args.slice(1), "delete");
  const name = positionals[0];
  if (!name) {
    throw new AxiError(
      "Secret name is required: gh-axi secret delete <name>",
      "VALIDATION_ERROR",
    );
  }

  await ghExec(["secret", "delete", name, ...scopeArgs], ctx);
  const suggestions = getSuggestions({
    domain: "secret",
    action: "delete",
    id: name,
    repo: ctx,
  });
  return renderOutput([
    encode({ delete: "ok", secret: name }),
    renderHelp(suggestions),
  ]);
}

export async function secretCommand(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const sub = args[0];

  if (sub === "--help" || sub === undefined) return SECRET_HELP;

  switch (sub) {
    case "list":
      return listSecrets(args, ctx);
    case "set":
      return setSecret(args, ctx);
    case "delete":
      return deleteSecret(args, ctx);
    default:
      return renderError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Available subcommands: list, set, delete",
      ]);
  }
}
