import { encode } from "@toon-format/toon";
import { ghJson, ghExec, ghRaw } from "../gh.js";
import { AxiError, mapGhError } from "../errors.js";
import { hasFlag, takeBoolFlag, takeFlag } from "../args.js";
import { renderHelp, renderOutput, renderError } from "../toon.js";
import { getSuggestions } from "../suggestions.js";

export const STACK_HELP = `usage: gh-axi stack <subcommand> [flags]
requires: the official gh-stack extension — \`gh extension install github/gh-stack\` (gh >= 2.90.0)
subcommands[16]:
  init <branch...>, add [branch], view, push, submit, sync, rebase, link <branch-or-pr...>, merge, checkout <n|pr|branch>, unstack (alias: delete), up [n], down [n], top, bottom, trunk
flags{init}:
  -b/--base <branch> (trunk, defaults to repo default branch)
flags{add}:
  -A/--all or -u/--update (stage changes; requires -m), -m/--message <text>
flags{view}:
  -s/--short (branch names only; default output is full JSON as TOON)
flags{submit}:
  --open (mark PRs ready for review; PRs are drafts by default), --remote <name> — always runs with --auto (no interactive editor)
flags{sync}:
  --prune (delete branches for merged PRs), --remote <name>
flags{rebase}:
  --downstack, --upstack, --no-trunk, --continue, --abort, --remote <name>
flags{link}:
  --base <branch>, --open, --remote <name>
flags{merge}:
  --yes/-y (required — merging is irreversible), --squash/--merge/--rebase or --merge-method <method>
flags{unstack}:
  --yes/-y (required unless --local — unstacking also unstacks on GitHub), --local (remove local tracking only)
notes:
  not wrapped — use \`gh stack\` directly: modify, switch (interactive TUIs), alias, feedback (local utilities)
  -R/--repo is rejected — every subcommand acts on the local git checkout
examples:
  gh-axi stack init my-feature
  gh-axi stack add -Am "add parser" my-feature-2
  gh-axi stack view
  gh-axi stack submit
  gh-axi stack merge --yes`;

const UNWRAPPED = new Set(["modify", "switch", "alias", "feedback"]);

const SUBCOMMANDS =
  "init, add, view, push, submit, sync, rebase, link, merge, checkout, unstack (alias: delete), up, down, top, bottom, trunk";

// gh stack view is the one subcommand whose args gh-axi rebuilds instead of
// forwarding, so gh never sees a typo like `--shrot` and cannot reject it.
const VIEW_ARGS = new Set(["-s", "--short", "--json"]);

async function viewStack(args: string[]): Promise<string> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) return STACK_HELP;
  const unknown = args.filter((a) => !VIEW_ARGS.has(a));
  if (unknown.length > 0)
    throw new AxiError(
      `Unknown argument(s) for stack view: ${unknown.join(", ")}`,
      "VALIDATION_ERROR",
      ["stack view takes no positionals and accepts only -s/--short, --json"],
    );
  const short = hasFlag(args, "--short") || hasFlag(args, "-s");
  if (short && hasFlag(args, "--json"))
    throw new AxiError(
      "stack view accepts either --short or --json, not both",
      "VALIDATION_ERROR",
      [
        "--short lists branch names; --json (the default) returns the full stack",
      ],
    );
  if (short) {
    const out = await ghExec(["stack", "view", "--short"]);
    return renderOutput([
      out.trim(),
      renderHelp(getSuggestions({ domain: "stack", action: "view" })),
    ]);
  }
  const data = await ghJson(["stack", "view", "--json"]);
  return renderOutput([
    encode({ stack: data }),
    renderHelp(getSuggestions({ domain: "stack", action: "view" })),
  ]);
}

/**
 * Run a gh stack subcommand and pass its (already terse) output through.
 * Every subcommand but `view` writes its result to stderr and leaves stdout
 * empty (gh-stack v0.1.0), so both streams have to be read or the caller only
 * ever sees `<sub>: ok` — dropping, among other things, submit's PR URLs.
 */
async function runStack(sub: string, ghArgs: string[]): Promise<string> {
  const result = await ghRaw(["stack", sub, ...ghArgs]);
  if (result.exitCode !== 0) throw mapGhError(result.stderr, result.exitCode);
  const out = [result.stdout.trim(), result.stderr.trim()]
    .filter(Boolean)
    .join("\n");
  return renderOutput([
    out || encode({ [sub]: "ok" }),
    renderHelp(getSuggestions({ domain: "stack", action: sub })),
  ]);
}

function hasPositional(args: string[]): boolean {
  return args.some((a) => !a.startsWith("-"));
}

// Shorts that swallow the rest of a bundle as their value, so `-Amfix parser`
// is -A plus -m "fix parser", not the letters f, i and x.
const VALUE_SHORTS = "mb";

function shortFlagsOf(arg: string): string {
  if (!arg.startsWith("-") || arg.startsWith("--")) return "";
  let flags = "";
  for (const char of arg.slice(1)) {
    if (!/[A-Za-z]/.test(char)) break;
    flags += char;
    if (VALUE_SHORTS.includes(char)) break;
  }
  return flags;
}

/** True when -short or --long is present, in space, equals or bundled form. */
function hasOpt(args: string[], short: string, long: string): boolean {
  return args.some(
    (a) =>
      a === long || a.startsWith(`${long}=`) || shortFlagsOf(a).includes(short),
  );
}

/** True when add stages changes (-A/-u/--all/--update, incl. bundled -Am). */
function stagesChanges(args: string[]): boolean {
  return hasOpt(args, "A", "--all") || hasOpt(args, "u", "--update");
}

function hasMessage(args: string[]): boolean {
  return hasOpt(args, "m", "--message");
}

// stackCommand has no ctx parameter — gh stack operates on the local git
// checkout and rejects --repo, which gh.ts#buildArgs would append for any
// non-git RepoContext. Same structural trick as the user-scoped commands;
// see AGENTS.md "Extension-backed commands".
export async function stackCommand(args: string[]): Promise<string> {
  const sub = args[0];
  if (sub === "--help" || sub === undefined) return STACK_HELP;

  const rest = args.slice(1);

  switch (sub) {
    case "init": {
      const scan = [...rest];
      takeFlag(scan, "--base");
      takeFlag(scan, "-b");
      if (!hasPositional(scan))
        throw new AxiError(
          "Branch name is required (no-arg init prompts interactively): gh-axi stack init <branch...>",
          "VALIDATION_ERROR",
        );
      return runStack(sub, rest);
    }
    case "add":
      if (stagesChanges(rest) && !hasMessage(rest))
        throw new AxiError(
          '-A/-u requires -m <message> (without it gh opens an editor): gh-axi stack add -Am "..."',
          "VALIDATION_ERROR",
        );
      return runStack(sub, rest);
    case "view":
      return viewStack(rest);
    case "submit":
      if (!hasFlag(rest, "--auto")) rest.push("--auto");
      return runStack(sub, rest);
    case "merge":
      if (!hasFlag(rest, "--yes") && !hasFlag(rest, "-y"))
        throw new AxiError(
          "stack merge is irreversible — confirm with: gh-axi stack merge --yes",
          "VALIDATION_ERROR",
        );
      return runStack(sub, rest);
    case "checkout":
      if (!hasPositional(rest))
        throw new AxiError(
          "Target is required (no-arg checkout opens an interactive picker): gh-axi stack checkout <n|pr|url|branch>",
          "VALIDATION_ERROR",
        );
      return runStack(sub, rest);
    case "unstack":
    case "delete": {
      if (!hasFlag(rest, "--local")) {
        const long = takeBoolFlag(rest, "--yes");
        const shortForm = takeBoolFlag(rest, "-y");
        if (!long && !shortForm)
          throw new AxiError(
            `stack ${sub} unstacks the stack on GitHub — confirm with: gh-axi stack ${sub} --yes`,
            "VALIDATION_ERROR",
            [`Use \`gh-axi stack ${sub} --local\` to drop local tracking only`],
          );
      }
      return runStack(sub, rest);
    }
    case "push":
    case "sync":
    case "rebase":
    case "link":
    case "up":
    case "down":
    case "top":
    case "bottom":
    case "trunk":
      return runStack(sub, rest);
    default:
      if (UNWRAPPED.has(sub))
        return renderError(
          `\`${sub}\` is not wrapped — run \`gh stack ${sub}\` directly`,
          "VALIDATION_ERROR",
          [`Available subcommands: ${SUBCOMMANDS}`],
        );
      return renderError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        `Available subcommands: ${SUBCOMMANDS}`,
      ]);
  }
}
