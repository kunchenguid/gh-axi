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
flags{set}:
  value is read only from piped stdin; --body/-b is not accepted for secrets
values are never printed: \`list\` only exposes name and update time, matching \`gh secret list\`
examples:
  gh-axi secret list
  echo -n "sk-..." | gh-axi secret set OPENAI_API_KEY
  gh-axi secret delete OPENAI_API_KEY`;

const listSchema: FieldDef[] = [
  field("name"),
  relativeTime("updatedAt", "updated"),
];

function hasBodyFlag(args: string[]): boolean {
  return args.some(
    (arg) =>
      arg === "--body" ||
      arg.startsWith("--body=") ||
      arg === "-b" ||
      arg.startsWith("-b="),
  );
}

async function listSecrets(
  _args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const secrets = await ghJson<Record<string, unknown>[]>(
    ["secret", "list", "--json", "name,updatedAt"],
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

  const positionals = remaining.filter((a) => !a.startsWith("-"));
  const name = positionals[0];
  if (!name) {
    throw new AxiError(
      "Secret name is required: gh-axi secret set <name>",
      "VALIDATION_ERROR",
    );
  }

  const value = await resolveValue(undefined, "secret");
  await ghExecWithStdin(["secret", "set", name], value, ctx);

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
  const positionals = args.filter((a) => !a.startsWith("-"));
  const name = positionals[1];
  if (!name) {
    throw new AxiError(
      "Secret name is required: gh-axi secret delete <name>",
      "VALIDATION_ERROR",
    );
  }

  await ghExec(["secret", "delete", name], ctx);
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
