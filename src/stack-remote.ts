import { execFile } from "node:child_process";
import { AxiError } from "./errors.js";

interface GitResult {
  stdout: string;
  exitCode: number;
}

export type GitRunner = (args: string[]) => Promise<GitResult>;

export async function resolveStackRemote(
  args: string[],
  runGit: GitRunner = runGitCommand,
): Promise<string[]> {
  if (hasRemote(args)) return args;
  return resolveRemote(args, await currentBranch(runGit), runGit);
}

export async function resolveStackLinkRemote(
  args: string[],
  refs: string[],
  runGit: GitRunner = runGitCommand,
): Promise<string[]> {
  if (hasRemote(args)) return args;

  const branch = await firstLocalBranch(refs, runGit);
  return branch ? resolveRemote(args, branch, runGit) : args;
}

async function resolveRemote(
  args: string[],
  branch: string | undefined,
  runGit: GitRunner,
): Promise<string[]> {
  const configKeys = [
    ...(branch ? [`branch.${branch}.pushRemote`] : []),
    "remote.pushDefault",
    ...(branch ? [`branch.${branch}.remote`] : []),
    "gh-stack.remote",
  ];

  for (const key of configKeys) {
    const value = await configValue(runGit, key);
    if (value) return [...args, "--remote", value];
  }

  const remotes = await runGit(["remote"]);
  if (remotes.exitCode !== 0) throw unknownRemote();

  const names = remotes.stdout.trim().split(/\s+/).filter(Boolean);
  if (names.length === 1) return [...args, "--remote", names[0]];
  if (names.length > 1) {
    throw new AxiError(
      "Multiple git remotes are configured; pass --remote <name>",
      "VALIDATION_ERROR",
      ["Pass `--remote <name>` to select the remote for this stack operation"],
    );
  }
  throw unknownRemote();
}

function hasRemote(args: string[]): boolean {
  return args.some((arg) => arg === "--remote" || arg.startsWith("--remote="));
}

async function currentBranch(runGit: GitRunner): Promise<string | undefined> {
  const result = await runGit(["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return result.exitCode === 0 ? result.stdout.trim() || undefined : undefined;
}

async function firstLocalBranch(
  refs: string[],
  runGit: GitRunner,
): Promise<string | undefined> {
  const result = await runGit([
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads",
  ]);
  if (result.exitCode !== 0) throw unknownRemote();

  const localBranches = new Set(
    result.stdout.split("\n").map((branch) => branch.trim()).filter(Boolean),
  );
  return refs.find((ref) => localBranches.has(ref));
}

async function configValue(
  runGit: GitRunner,
  key: string,
): Promise<string | undefined> {
  const result = await runGit(["config", "--get", key]);
  if (result.exitCode === 0) return result.stdout.trim() || undefined;
  if (result.exitCode === 1) return undefined;
  throw unknownRemote();
}

function unknownRemote(): AxiError {
  return new AxiError(
    "Could not determine a git remote; pass --remote <name>",
    "VALIDATION_ERROR",
    ["Pass `--remote <name>` to select the remote for this stack operation"],
  );
}

function runGitCommand(args: string[]): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile("git", args, (error, stdout) => {
      const exitCode = error
        ? ((error as Error & { code?: string | number }).code ?? 1)
        : 0;
      resolve({
        stdout: stdout ?? "",
        exitCode: typeof exitCode === "number" ? exitCode : 1,
      });
    });
  });
}
