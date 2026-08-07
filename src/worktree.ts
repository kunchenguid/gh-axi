import { execFileSync } from "node:child_process";

export function baseBranchNeedsExplicitRepo(baseRefName: string): boolean {
  try {
    const currentRoot = runGit(["rev-parse", "--show-toplevel"]);
    const output = runGit(["worktree", "list", "--porcelain", "-z"]);
    let worktree = "";
    let branch = "";

    for (const field of output.split("\0")) {
      if (field.startsWith("worktree ")) {
        worktree = field.slice("worktree ".length);
      } else if (field.startsWith("branch ")) {
        branch = field.slice("branch ".length);
      } else if (field === "") {
        if (
          worktree !== currentRoot &&
          branch === `refs/heads/${baseRefName}`
        ) {
          return true;
        }
        worktree = "";
        branch = "";
      }
    }

    return false;
  } catch {
    return true;
  }
}

function runGit(args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}
