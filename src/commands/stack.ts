import { encode } from "@toon-format/toon";
import { ghRaw, type ExecResult } from "../gh.js";
import { AxiError, StackError } from "../errors.js";

type StackBranch = {
  name: string;
  head?: string;
  base?: string;
  isCurrent: boolean;
  isMerged: boolean;
  isQueued: boolean;
  needsRebase: boolean;
  pr?: { number: number; url?: string; state?: string };
};

type StackView = {
  trunk?: string;
  currentBranch?: string;
  branches: StackBranch[];
};

type FlagSpec = Record<string, "boolean" | "value">;

export const STACK_HELP = `usage: gh-axi stack <subcommand> [args] [flags]
subcommands[16]:
  view, init <branches...>, add [branch], checkout <stack|pr|url|branch>, push, submit, sync, rebase [branch], link <refs...>, unstack [stack], merge <stack|pr>, up [n], down [n], top, bottom, trunk
flags{init}: --base <branch>
flags{add}: --message <text>, --all, --update
flags{push}: --remote <name>
flags{submit}: --open, --remote <name> (--auto is always applied)
flags{sync}: --prune, --remote <name>
flags{rebase}: --downstack, --upstack, --no-trunk, --continue, --abort, --remote <name>, --committer-date-is-author-date, --preserve-dates
flags{link}: --base <branch>, --open, --remote <name>
flags{unstack}: --local
flags{merge}: --merge-method <merge|squash|rebase>, --merge, --squash, --rebase (--yes is always applied)
notes:
  Requires the official extension: gh extension install github/gh-stack
  Operates on the git repository in the current working directory; -R, --repo, and GH_REPO are not supported
examples:
  gh-axi stack init feature-model feature-api
  gh-axi stack submit --open
  gh-axi stack view
  gh-axi stack rebase --continue
  gh-axi stack merge 42 --squash`;

const REMOTE_FLAGS: FlagSpec = { "--remote": "value" };
// eslint-disable-next-line no-control-regex -- upstream status may contain ANSI color sequences
const ANSI_ESCAPE = new RegExp("\\u001b\\[[0-9;]*m", "g");
const STATUS_MARKER = /^([✓✗⚠ℹ])\s*/;
const NON_FAILURE_MARKERS = ["✓", "ℹ"];
const FAILURE_DIAGNOSTIC =
  /failed|could not|couldn't|cannot create|not .*updated automatically|remain stacked|not fully|skipping rebase/i;

type Diagnostic = { marker: string; text: string };

export async function stackCommand(args: string[]): Promise<string> {
  if (args.length === 0 || args.includes("--help")) return STACK_HELP;

  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case "view":
      parseArgs(rest, {}, 0, 0);
      return stackView();
    case "init":
      parseArgs(rest, { "-b": "value", "--base": "value" }, 1);
      return runStack(subcommand, rest);
    case "add":
      validateAdd(rest);
      return runStack(subcommand, rest);
    case "checkout":
      parseArgs(rest, {}, 1, 1);
      return runStack(subcommand, rest);
    case "push":
      parseArgs(rest, REMOTE_FLAGS, 0, 0);
      return runStack(subcommand, rest);
    case "submit":
      parseArgs(rest, { ...REMOTE_FLAGS, "--open": "boolean" }, 0, 0);
      return runStack(subcommand, [...rest, "--auto"]);
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
        {
          ...REMOTE_FLAGS,
          "--base": "value",
          "--open": "boolean",
        },
        2,
      );
      return runStack(subcommand, rest);
    case "unstack":
      parseArgs(rest, { "--local": "boolean" }, 0, 1);
      return runStack(subcommand, rest);
    case "merge":
      validateMerge(rest);
      return runStack(subcommand, [...rest, "--yes"]);
    case "up":
    case "down": {
      const positional = parseArgs(rest, {}, 0, 1);
      if (positional[0] && !/^[1-9]\d*$/.test(positional[0])) {
        throw validation(`${subcommand} distance must be a positive integer`);
      }
      return runStack(subcommand, rest);
    }
    case "top":
    case "bottom":
    case "trunk":
      parseArgs(rest, {}, 0, 0);
      return runStack(subcommand, rest);
    default:
      throw validation(`Unknown stack subcommand: ${subcommand}`);
  }
}

async function stackView(): Promise<string> {
  const result = await execute(["stack", "view", "--json"]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw unexpectedOutput(result.stdout);
  }
  if (!isStackView(parsed)) throw unexpectedOutput(result.stdout);
  const view = parsed;

  return encode({
    stack: {
      trunk: view.trunk ?? null,
      current_branch: view.currentBranch ?? null,
      branch_count: view.branches.length,
    },
    branches: view.branches.map((branch) => ({
      name: branch.name,
      current: branch.isCurrent,
      state: branch.isMerged
        ? "merged"
        : branch.isQueued
          ? "queued"
          : (branch.pr?.state?.toLowerCase() ?? "local"),
      needs_rebase: branch.needsRebase,
      pr: branch.pr?.number ?? null,
      url: branch.pr?.url ?? null,
    })),
  });
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

async function runStack(action: string, args: string[]): Promise<string> {
  const result = await execute(["stack", action, ...args]);
  // Classify from stderr only: stdout echoes user-supplied text (commit
  // subjects, branch names) that reads like a failure report. Lines the
  // extension itself marks as succeeded are excluded for the same reason;
  // everything else, including unmarked git subprocess diagnostics, counts.
  const stderrDiagnostics = diagnostics(result.stderr);
  const messages = [
    ...lines(result.stdout),
    ...stderrDiagnostics.map(({ text }) => text),
  ];
  const aborted = stderrDiagnostics.some(({ text }) =>
    /sync aborted/i.test(text),
  );
  const partial = stderrDiagnostics.some(isFailureDiagnostic);
  const warned = result.stderr.includes("⚠");
  return encode({
    stack: {
      action,
      status: aborted
        ? "aborted"
        : partial
          ? "partial"
          : warned
            ? "warning"
            : "ok",
      messages: messages.length > 0 ? messages : ["completed"],
    },
  });
}

async function execute(args: string[]): Promise<ExecResult> {
  const result = await ghRaw(args);
  if (result.exitCode === 0) return result;

  const diagnostics = [...lines(result.stderr), ...lines(result.stdout)];
  const message =
    diagnostics.join("\n") || `gh stack exited with code ${result.exitCode}`;
  if (/unknown command ["']?stack/i.test(result.stderr)) {
    throw new StackError(message, result.exitCode, [
      "Run `gh extension install github/gh-stack` to install the official extension",
    ]);
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
      return ["Run `gh-axi stack init <branch>` to create or adopt a stack"];
    case 3:
      if (action === "rebase") {
        return [
          "Resolve conflicts, stage the files with `git add`, then run `gh-axi stack rebase --continue`",
          "Run `gh-axi stack rebase --abort` to restore the stack",
        ];
      }
      if (action === "sync") {
        return [
          "The sync restored the stack; run `gh-axi stack rebase` to resolve conflicts explicitly",
        ];
      }
      if (action === "checkout") {
        return [
          "Reconcile the local and remote stack, or run `gh-axi stack unstack --local` before retrying checkout",
        ];
      }
      return ["Resolve the reported conflict, then retry the stack operation"];
    case 4:
      return ["Run `gh auth status` and retry the command"];
    case 6:
      return ["Check out a branch that belongs to only one stack and retry"];
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

function validateAdd(args: string[]): void {
  const normalized = args.flatMap((arg) =>
    arg === "-Am" ? ["-A", "-m"] : arg === "-um" ? ["-u", "-m"] : [arg],
  );
  const positional = parseArgs(
    normalized,
    {
      "-m": "value",
      "--message": "value",
      "-A": "boolean",
      "--all": "boolean",
      "-u": "boolean",
      "--update": "boolean",
    },
    0,
    1,
  );
  const hasMessage = normalized.some(
    (arg) =>
      arg === "-m" || arg === "--message" || arg.startsWith("--message="),
  );
  const stagesAll = normalized.some((arg) => arg === "-A" || arg === "--all");
  const stagesTracked = normalized.some(
    (arg) => arg === "-u" || arg === "--update",
  );
  if (stagesAll && stagesTracked)
    throw validation("Choose only --all or --update");
  if ((stagesAll || stagesTracked) && !hasMessage) {
    throw validation("--all and --update require --message");
  }
  if (positional.length === 0 && !hasMessage) {
    throw validation("stack add requires a branch or --message");
  }
}

function validateMerge(args: string[]): void {
  parseArgs(
    args,
    {
      "--merge-method": "value",
      "--merge": "boolean",
      "--squash": "boolean",
      "--rebase": "boolean",
    },
    1,
    1,
  );
  const methods = args.filter(
    (arg) =>
      ["--merge", "--squash", "--rebase", "--merge-method"].includes(arg) ||
      arg.startsWith("--merge-method="),
  );
  if (methods.length > 1) throw validation("Choose only one merge method");
}

function parseArgs(
  args: string[],
  flags: FlagSpec,
  minPositionals: number,
  maxPositionals = Number.POSITIVE_INFINITY,
): string[] {
  const positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith("-")) {
      positional.push(arg);
      continue;
    }
    const [name, equalsValue] = arg.split("=", 2);
    const kind = flags[name];
    if (!kind) throw validation(`Unsupported stack flag: ${name}`);
    if (kind === "boolean") {
      if (equalsValue !== undefined)
        throw validation(`${name} does not take a value`);
      continue;
    }
    const valueFromEquals = equalsValue !== undefined;
    const value = equalsValue ?? args[++index];
    if (!value || (!valueFromEquals && value.startsWith("-")))
      throw validation(`${name} requires a value`);
  }
  if (positional.length < minPositionals) {
    throw validation(
      `Expected at least ${minPositionals} stack argument${minPositionals === 1 ? "" : "s"}`,
    );
  }
  if (positional.length > maxPositionals) {
    throw validation(
      `Expected at most ${maxPositionals} stack argument${maxPositionals === 1 ? "" : "s"}`,
    );
  }
  return positional;
}

function diagnostics(output: string): Diagnostic[] {
  return output
    .replace(ANSI_ESCAPE, "")
    .split("\n")
    .flatMap((line) => {
      const trimmed = line.trim();
      const match = STATUS_MARKER.exec(trimmed);
      const marker = match ? match[1] : "";
      const text = match ? trimmed.slice(match[0].length).trim() : trimmed;
      return text ? [{ marker, text }] : [];
    });
}

function lines(output: string): string[] {
  return diagnostics(output).map(({ text }) => text);
}

function isFailureDiagnostic({ marker, text }: Diagnostic): boolean {
  return !NON_FAILURE_MARKERS.includes(marker) && FAILURE_DIAGNOSTIC.test(text);
}

function validation(message: string): AxiError {
  return new AxiError(message, "VALIDATION_ERROR", [
    "Run `gh-axi stack --help` to see agent-safe forms",
  ]);
}
