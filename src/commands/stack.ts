import { encode } from "@toon-format/toon";
import { ghRaw, type ExecResult } from "../gh.js";
import { AxiError, StackError } from "../errors.js";
import { getSuggestions } from "../suggestions.js";
import { renderHelp, renderOutput } from "../toon.js";

interface StackBranch {
  name?: string;
  head?: string;
  base?: string;
  isCurrent?: boolean;
  isMerged?: boolean;
  isQueued?: boolean;
  needsRebase?: boolean;
  pr?: {
    number?: number;
    url?: string;
    state?: string;
  };
}

interface StackView {
  trunk?: string;
  currentBranch?: string;
  branches: StackBranch[];
}

type FlagKind = "boolean" | "value";
type FlagSpec = Record<string, FlagKind>;

interface ParsedArgs {
  positionals: string[];
  seen: Set<string>;
}

export const STACK_HELP = `usage: gh-axi stack <subcommand> [args] [flags]
subcommands[16]:
  view, init <branches...>, add [branch], checkout <stack|pr|url|branch>, push, submit, sync, rebase [branch], link <refs...>, unstack [stack], merge <stack|pr>, up [n], down [n], top, bottom, trunk
flags{view}:
  --json is automatic; structured TOON output is always returned
flags{init}:
  -b/--base <branch>
flags{add}:
  -m/--message <text>, -A/--all, -u/--update (staging flags require a message)
flags{push}:
  --remote <name>
flags{submit}:
  --open, --remote <name> (--auto is automatic)
flags{sync}:
  --prune, --remote <name>
flags{rebase}:
  --downstack, --upstack, --no-trunk, --continue, --abort, --remote <name>, --committer-date-is-author-date, --preserve-dates
flags{link}:
  --base <branch>, --open, --remote <name>
flags{unstack}:
  --local
flags{merge}:
  --merge-method <merge|squash|rebase>, --merge, --squash, --rebase (--yes is automatic)
notes:
  Requires the official extension: gh extension install github/gh-stack
  Operates on the git repository in the current working directory; -R, --repo, and GH_REPO are not supported
  Not wrapped: modify, switch, alias, feedback (use gh stack directly)
examples:
  gh-axi stack init feature-model feature-api
  gh-axi stack submit --open
  gh-axi stack view
  gh-axi stack rebase --continue
  gh-axi stack merge 42 --squash`;

const REMOTE_FLAGS: FlagSpec = { "--remote": "value" };
const ADD_FLAGS: FlagSpec = {
  "-m": "value",
  "--message": "value",
  "-A": "boolean",
  "--all": "boolean",
  "-u": "boolean",
  "--update": "boolean",
};

export async function stackCommand(args: string[]): Promise<string> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    return STACK_HELP;
  }

  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case "view":
      parseArgs(rest, { "--json": "boolean" }, 0, 0);
      return viewStack();
    case "init":
      parseArgs(rest, { "-b": "value", "--base": "value" }, 1);
      return runStack(subcommand, rest);
    case "add":
      return addStack(rest);
    case "checkout":
      parseArgs(rest, {}, 1, 1);
      return runStack(subcommand, rest);
    case "push":
      parseArgs(rest, REMOTE_FLAGS, 0, 0);
      return runStack(subcommand, rest);
    case "submit":
      parseArgs(
        rest,
        { ...REMOTE_FLAGS, "--open": "boolean", "--auto": "boolean" },
        0,
        0,
      );
      return runStack(
        subcommand,
        hasFlag(rest, "--auto") ? rest : [...rest, "--auto"],
      );
    case "sync":
      parseArgs(rest, { ...REMOTE_FLAGS, "--prune": "boolean" }, 0, 0);
      return runStack(subcommand, rest);
    case "rebase":
      parseArgs(
        rest,
        {
          ...REMOTE_FLAGS,
          "--downstack": "boolean",
          "--upstack": "boolean",
          "--no-trunk": "boolean",
          "--continue": "boolean",
          "--abort": "boolean",
          "--committer-date-is-author-date": "boolean",
          "--preserve-dates": "boolean",
        },
        0,
        1,
      );
      return runStack(subcommand, rest);
    case "link":
      parseArgs(
        rest,
        { ...REMOTE_FLAGS, "--base": "value", "--open": "boolean" },
        2,
      );
      return runStack(subcommand, rest);
    case "unstack":
      parseArgs(rest, { "--local": "boolean" }, 0, 1);
      return runStack(subcommand, rest);
    case "merge":
      return mergeStack(rest);
    case "up":
    case "down":
      return navigateStack(subcommand, rest);
    case "top":
    case "bottom":
    case "trunk":
      parseArgs(rest, {}, 0, 0);
      return runStack(subcommand, rest);
    case "modify":
    case "switch":
    case "alias":
    case "feedback":
      throw validation(
        `${subcommand} is not wrapped because it is interactive or human-only; run gh stack ${subcommand} directly`,
      );
    default:
      throw validation(`Unknown stack subcommand: ${subcommand}`);
  }
}

async function viewStack(): Promise<string> {
  const result = await execute(["stack", "view", "--json"]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw unexpectedOutput(result.stdout);
  }
  if (!isStackView(parsed)) throw unexpectedOutput(result.stdout);

  const view = parsed;
  const stack: Record<string, unknown> = {
    trunk: view.trunk ?? null,
    current_branch: view.currentBranch ?? null,
    branch_count: view.branches.length,
    branches: view.branches.map((branch) => ({
      name: branch.name ?? null,
      head: branch.head ?? null,
      base: branch.base ?? null,
      current: branch.isCurrent ?? false,
      merged: branch.isMerged ?? false,
      queued: branch.isQueued ?? false,
      needs_rebase: branch.needsRebase ?? false,
      pr: branch.pr
        ? {
            number: branch.pr.number ?? null,
            url: branch.pr.url ?? null,
            state: branch.pr.state?.toLowerCase() ?? null,
          }
        : null,
    })),
  };
  if (result.stderr.trim()) stack.diagnostics = result.stderr.trim();

  return renderOutput([
    encode({ stack }),
    renderHelp(getSuggestions({ domain: "stack", action: "view" })),
  ]);
}

function isStackView(value: unknown): value is StackView {
  if (typeof value !== "object" || value === null) return false;
  const branches = (value as { branches?: unknown }).branches;
  return (
    Array.isArray(branches) &&
    branches.every((branch) => typeof branch === "object" && branch !== null)
  );
}

function unexpectedOutput(stdout: string): AxiError {
  return new AxiError(
    `Unexpected gh stack output: ${stdout.slice(0, 200)}`,
    "UNKNOWN",
  );
}

async function addStack(args: string[]): Promise<string> {
  const normalized = expandAddShortFlags(args);
  const parsed = parseArgs(normalized, ADD_FLAGS, 0, 1);
  const hasMessage = parsed.seen.has("-m") || parsed.seen.has("--message");
  const stagesAll = parsed.seen.has("-A") || parsed.seen.has("--all");
  const stagesTracked = parsed.seen.has("-u") || parsed.seen.has("--update");

  if (stagesAll && stagesTracked) {
    throw validation("Choose only one of --all or --update");
  }
  if ((stagesAll || stagesTracked) && !hasMessage) {
    throw validation("--all and --update require --message");
  }
  // gh-stack can generate a branch name when -m is supplied, so a message is
  // a safe non-interactive alternative to an explicit branch name.
  if (parsed.positionals.length === 0 && !hasMessage) {
    throw validation("stack add requires a branch or --message");
  }

  return runStack("add", args);
}

async function mergeStack(args: string[]): Promise<string> {
  const parsed = parseArgs(
    args,
    {
      "--merge-method": "value",
      "--merge": "boolean",
      "--squash": "boolean",
      "--rebase": "boolean",
      "--yes": "boolean",
      "-y": "boolean",
    },
    1,
    1,
  );
  const methods = ["--merge-method", "--merge", "--squash", "--rebase"].filter(
    (flag) => parsed.seen.has(flag),
  );
  if (methods.length > 1) throw validation("Choose only one merge method");

  const confirmed = parsed.seen.has("--yes") || parsed.seen.has("-y");
  return runStack("merge", confirmed ? args : [...args, "--yes"]);
}

async function navigateStack(
  subcommand: "up" | "down",
  args: string[],
): Promise<string> {
  const parsed = parseArgs(args, {}, 0, 1);
  const distance = parsed.positionals[0];
  if (distance !== undefined && !/^[1-9]\d*$/.test(distance)) {
    throw validation(`${subcommand} distance must be a positive integer`);
  }
  return runStack(subcommand, args);
}

async function runStack(action: string, args: string[]): Promise<string> {
  const result = await execute(["stack", action, ...args]);
  return renderOutput([
    encode({
      stack: {
        action,
        status: "ok",
        stdout: result.stdout,
        stderr: result.stderr,
      },
    }),
    renderHelp(getSuggestions({ domain: "stack", action })),
  ]);
}

async function execute(args: string[]): Promise<ExecResult> {
  const result = await ghRaw(args);
  if (result.exitCode === 0) return result;

  const details = [result.stderr.trim(), result.stdout.trim()].filter(Boolean);
  const message =
    details.join("\n") || `gh stack exited with code ${result.exitCode}`;
  if (/unknown command ["']stack["'] for ["']gh["']/i.test(result.stderr)) {
    throw new StackError(
      "The official gh-stack extension is not installed",
      result.exitCode,
      ["Run `gh extension install github/gh-stack` to install it"],
      "EXTENSION_NOT_INSTALLED",
    );
  }

  throw new StackError(
    message,
    result.exitCode,
    stackRecovery(args[1] ?? "", result.exitCode),
  );
}

function stackRecovery(action: string, exitCode: number): string[] {
  switch (exitCode) {
    case 2:
      return [
        "Run `gh-axi stack init <branch>` to create or adopt a stack",
        "Run `gh-axi stack checkout <stack|pr|branch>` to use an existing stack",
      ];
    case 3:
      if (action === "rebase") {
        return [
          "Resolve conflicts, stage files with `git add`, then run `gh-axi stack rebase --continue`",
          "Run `gh-axi stack rebase --abort` to restore the stack",
        ];
      }
      if (action === "sync") {
        return [
          "The stack was restored; run `gh-axi stack rebase` to resolve conflicts explicitly",
        ];
      }
      return ["Resolve the reported conflict, then retry the stack operation"];
    case 4:
      return ["Run `gh auth status` and retry the command"];
    case 6:
      return ["Check out a branch that belongs to only one stack, then retry"];
    case 7:
      return [
        "Run `gh-axi stack rebase --continue` after resolving conflicts, or `gh-axi stack rebase --abort`",
      ];
    case 8:
      return ["Wait for the other stack operation to finish, then retry"];
    case 9:
      return ["Enable stacked PRs for this repository before retrying"];
    case 10:
      return [
        "Use `gh stack modify --continue` or `gh stack modify --abort` to recover the interrupted session",
      ];
    default:
      return [];
  }
}

function validation(message: string): AxiError {
  return new AxiError(message, "VALIDATION_ERROR", [
    "Run `gh-axi stack --help` to see agent-safe forms",
  ]);
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function parseArgs(
  args: string[],
  flags: FlagSpec,
  minPositionals: number,
  maxPositionals = Number.POSITIVE_INFINITY,
): ParsedArgs {
  const positionals: string[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith("-")) {
      positionals.push(arg);
      continue;
    }

    const equalsIndex = arg.indexOf("=");
    const name = equalsIndex === -1 ? arg : arg.slice(0, equalsIndex);
    const inlineValue =
      equalsIndex === -1 ? undefined : arg.slice(equalsIndex + 1);
    const kind = flags[name];
    if (!kind) throw validation(`Unsupported stack flag: ${name}`);

    seen.add(name);
    if (kind === "boolean") {
      if (inlineValue !== undefined) {
        throw validation(`${name} does not take a value`);
      }
      continue;
    }

    if (inlineValue !== undefined) {
      if (inlineValue === "") throw validation(`${name} requires a value`);
      continue;
    }

    const value = args[++index];
    if (!value || value.startsWith("-")) {
      throw validation(`${name} requires a value`);
    }
  }

  if (positionals.length < minPositionals) {
    throw validation(
      `Expected at least ${minPositionals} stack argument${minPositionals === 1 ? "" : "s"}`,
    );
  }
  if (positionals.length > maxPositionals) {
    throw validation(
      `Expected at most ${maxPositionals} stack argument${maxPositionals === 1 ? "" : "s"}`,
    );
  }

  return { positionals, seen };
}

function expandAddShortFlags(args: string[]): string[] {
  const expanded: string[] = [];
  for (const arg of args) {
    if (!arg.startsWith("-") || arg.startsWith("--") || arg.length <= 2) {
      expanded.push(arg);
      continue;
    }

    const flags = arg.slice(1);
    let consumedValue = false;
    for (let index = 0; index < flags.length; index++) {
      const flag = flags[index];
      if (flag === "m") {
        const attached = flags.slice(index + 1);
        expanded.push(attached ? `-m=${attached}` : "-m");
        consumedValue = true;
        break;
      }
      if (flag === "A" || flag === "u") {
        expanded.push(`-${flag}`);
        continue;
      }
      expanded.push(arg);
      consumedValue = true;
      break;
    }
    if (consumedValue) continue;
  }
  return expanded;
}
