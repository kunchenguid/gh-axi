import { execFileSync } from "node:child_process";
import { escapeRegExp, resolveHost, type HostContext } from "./host.js";

/**
 * A GitLab project has no fixed-depth owner/repo pair: groups nest
 * arbitrarily, and self-hosted instances make the host data, not a constant.
 * Identity is (host, full path, number); rebuild URLs from those parts.
 */
export interface ProjectContext {
  /** Full project path, e.g. "group/subgroup/project" */
  fullPath: string;
  /** How the project was resolved — flag/env sources get an explicit -R */
  source: "flag" | "env" | "git";
  host?: HostContext;
}

/**
 * Resolve the target project.
 * Priority: --repo flag > GITLAB_REPO env > git remote origin.
 */
export function resolveProject(flagValue?: string): ProjectContext | undefined {
  if (flagValue) {
    return parsePath(flagValue, "flag");
  }

  const envRepo = process.env["GITLAB_REPO"];
  if (envRepo) {
    return parsePath(envRepo, "env");
  }

  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return parseRemoteUrl(url);
  } catch {
    return undefined;
  }
}

function parsePath(
  path: string,
  source: "flag" | "env",
): ProjectContext | undefined {
  // glab -R accepts OWNER/REPO, GROUP/NAMESPACE/REPO, or a full URL. Normalize
  // a URL to its path so downstream URL building always has a bare full path.
  const urlMatch = path.match(/^https?:\/\/[^/]+\/(.+?)(?:\.git)?$/);
  const fullPath = urlMatch ? urlMatch[1] : path.replace(/\.git$/, "");
  if (!fullPath || fullPath.includes(" ")) return undefined;
  return { fullPath, source };
}

function parseRemoteUrl(url: string): ProjectContext | undefined {
  // Match against the configured host (defaults to gitlab.com), so remotes on
  // a self-hosted instance such as git.example.com resolve too. SSH
  // (git@<host>:group/sub/project.git) and HTTPS
  // (https://<host>/group/sub/project.git) differ only in the separator, and
  // the project path may nest arbitrarily, so capture everything up to .git.
  const host = escapeRegExp(resolveHost());
  const match = url.match(
    new RegExp(`(?:^|@|/)${host}[:/]([^/].+?)(?:\\.git)?$`),
  );
  return match ? { fullPath: match[1], source: "git" } : undefined;
}
