import { execFile } from "node:child_process";
import { encode } from "@toon-format/toon";
import { AxiError } from "../errors.js";
import { renderHelp, renderOutput } from "../toon.js";

export const PUSH_HELP = `usage: gh-axi push [remote] [refspec...] [flags]
description: Push git refs through gh-axi with compact AXI output.
flags[7]:
  -u/--set-upstream, --all, --tags, --follow-tags, --force-with-lease, --dry-run, --verbose
examples:
  gh-axi push
  gh-axi push origin main:main
  gh-axi push origin main:main codex/feature:codex/feature --follow-tags`;

const MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const ALLOWED_FLAGS = new Set([
  "-u",
  "--set-upstream",
  "--all",
  "--tags",
  "--follow-tags",
  "--force-with-lease",
  "--dry-run",
  "--verbose",
]);

type GitResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

type PushFlags = {
  setUpstream: boolean;
  all: boolean;
  tags: boolean;
  followTags: boolean;
  forceWithLease: boolean;
  dryRun: boolean;
  verbose: boolean;
};

type PushPlan = {
  flags: PushFlags;
  remote: string;
  refspecs: string[];
  mode: "current-branch" | "explicit" | "all" | "all+tags" | "tags";
  branch?: string;
  pushes: string[][];
};

function runGit(args: string[]): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { maxBuffer: MAX_BUFFER_BYTES },
      (error, stdout, stderr) => {
        if (error && "code" in error && error.code === "ENOENT") {
          resolve({ stdout: "", stderr: "ENOENT", exitCode: 127 });
          return;
        }
        const code = error && "code" in error ? error.code : 0;
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: typeof code === "number" ? code : error ? 1 : 0,
        });
      },
    );
  });
}

function firstLine(text: string): string {
  return text.trim().split(/\r?\n/).find(Boolean) ?? "";
}

async function currentBranch(): Promise<string> {
  const result = await runGit(["branch", "--show-current"]);
  if (result.stderr === "ENOENT") {
    throw new AxiError("git is not installed", "GIT_NOT_INSTALLED");
  }
  if (result.exitCode !== 0) {
    throw new AxiError(
      firstLine(result.stderr) || "Could not determine current branch",
      "GIT_ERROR",
    );
  }
  return result.stdout.trim();
}

function compactOutput(
  stdout: string,
  stderr: string,
  verbose: boolean,
): string[] {
  const combined = `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => verbose || !line.startsWith("remote:"));
  const interesting = combined.filter(
    (line) =>
      verbose ||
      line.startsWith("To ") ||
      line.startsWith("* ") ||
      line.startsWith("= ") ||
      line.startsWith("! ") ||
      line.startsWith("- ") ||
      line.startsWith("branch "),
  );
  const lines = interesting.length > 0 ? interesting : combined;
  return lines
    .slice(-20)
    .map((line) => (line.length > 240 ? `${line.slice(0, 237)}...` : line));
}

function parseArgs(args: string[]): {
  flags: PushFlags;
  positionals: string[];
} {
  const flags: PushFlags = {
    setUpstream: false,
    all: false,
    tags: false,
    followTags: false,
    forceWithLease: false,
    dryRun: false,
    verbose: false,
  };
  const positionals: string[] = [];

  for (const arg of args) {
    if (arg.startsWith("-")) {
      if (!ALLOWED_FLAGS.has(arg)) {
        throw new AxiError(`Unknown push flag: ${arg}`, "VALIDATION_ERROR", [
          "Run `gh-axi push --help` for supported flags",
        ]);
      }
      if (arg === "-u" || arg === "--set-upstream") flags.setUpstream = true;
      if (arg === "--all") flags.all = true;
      if (arg === "--tags") flags.tags = true;
      if (arg === "--follow-tags") flags.followTags = true;
      if (arg === "--force-with-lease") flags.forceWithLease = true;
      if (arg === "--dry-run") flags.dryRun = true;
      if (arg === "--verbose") flags.verbose = true;
      continue;
    }

    positionals.push(arg);
  }

  return { flags, positionals };
}

async function buildPushPlan(args: string[]): Promise<PushPlan> {
  const { flags, positionals } = parseArgs(args);
  const remote = positionals[0] ?? "origin";
  const explicitRefspecs = positionals.slice(positionals.length > 0 ? 1 : 0);

  if (flags.all && explicitRefspecs.length > 0) {
    throw new AxiError(
      "--all cannot be combined with explicit refspecs",
      "VALIDATION_ERROR",
    );
  }
  if (flags.tags && explicitRefspecs.length > 0) {
    throw new AxiError(
      "--tags cannot be combined with explicit refspecs",
      "VALIDATION_ERROR",
    );
  }

  const common = ["push"];
  if (flags.dryRun) common.push("--dry-run");
  if (flags.forceWithLease) common.push("--force-with-lease");
  if (flags.followTags && !flags.tags) common.push("--follow-tags");

  if (flags.all) {
    const pushes = [[...common, "--all", remote]];
    if (flags.tags) pushes.push([...common, "--tags", remote]);
    return {
      flags,
      remote,
      refspecs: [],
      mode: flags.tags ? "all+tags" : "all",
      pushes,
    };
  }

  if (flags.tags) {
    return {
      flags,
      remote,
      refspecs: [],
      mode: "tags",
      pushes: [[...common, "--tags", remote]],
    };
  }

  const branch =
    explicitRefspecs.length === 0 ? await currentBranch() : undefined;
  if (explicitRefspecs.length === 0 && !branch) {
    throw new AxiError(
      "No current branch; pass an explicit refspec",
      "VALIDATION_ERROR",
      ["Run `gh-axi push origin HEAD:<branch>`"],
    );
  }

  const refspecs =
    explicitRefspecs.length > 0 ? explicitRefspecs : [`HEAD:${branch}`];
  const push = [...common];
  if (flags.setUpstream || explicitRefspecs.length === 0)
    push.push("--set-upstream");
  push.push(remote, ...refspecs);

  return {
    flags,
    remote,
    refspecs,
    mode: explicitRefspecs.length === 0 ? "current-branch" : "explicit",
    ...(branch ? { branch } : {}),
    pushes: [push],
  };
}

export async function pushCommand(args: string[]): Promise<string> {
  if (args[0] === "--help" || (args.length > 0 && args[0] === "help"))
    return PUSH_HELP;

  const plan = await buildPushPlan(args);
  const output: string[] = [];

  for (const gitArgs of plan.pushes) {
    const result = await runGit(gitArgs);
    if (result.stderr === "ENOENT") {
      throw new AxiError("git is not installed", "GIT_NOT_INSTALLED");
    }
    output.push(
      ...compactOutput(result.stdout, result.stderr, plan.flags.verbose),
    );
    if (result.exitCode !== 0) {
      throw new AxiError(
        firstLine(result.stderr) || `git exited with code ${result.exitCode}`,
        "GIT_PUSH_FAILED",
        ["Run `gh-axi push --dry-run` to preview the push"],
      );
    }
  }

  const summary: Record<string, unknown> = {
    status: plan.flags.dryRun ? "dry-run-ok" : "ok",
    remote: plan.remote,
    mode: plan.mode,
    refs: plan.refspecs.length,
    refspecs: plan.refspecs,
  };
  if (plan.branch) summary.branch = plan.branch;
  if (plan.flags.forceWithLease) summary.force = "with-lease";
  if (plan.flags.followTags) summary.tags = "follow";

  const help = plan.flags.dryRun
    ? ["Run the same `gh-axi push` command without --dry-run to publish refs"]
    : [
        "Run `gh-axi repo view` to verify the default branch and repository summary",
      ];

  return renderOutput([
    encode({ push: summary }),
    output.length > 0 ? encode({ git: output }) : "",
    renderHelp(help),
  ]);
}
