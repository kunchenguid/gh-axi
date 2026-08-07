import { execFileSync } from "node:child_process";
import { escapeRegExp, resolveHost, type HostContext } from "./host.js";

export interface RepoContext {
  owner: string;
  name: string;
  /** Full "OWNER/NAME" string */
  nwo: string;
  /** How the repo was resolved — determines whether to append --repo to gh calls */
  source: "flag" | "env" | "git";
  host?: HostContext;
}

/**
 * Resolve the target repository.
 * Priority: --repo flag > GH_REPO env > git remotes (origin first).
 */
export function resolveRepo(flagValue?: string): RepoContext | undefined {
  if (flagValue) {
    return parseNwo(flagValue, "flag");
  }

  const envRepo = process.env["GH_REPO"];
  if (envRepo) {
    return parseNwo(envRepo, "env");
  }

  const origin = getRemoteUrl("origin");
  const originRepo = origin ? parseRemoteUrl(origin) : undefined;
  if (originRepo) return originRepo;

  for (const remote of listRemotes()) {
    if (remote === "origin") continue;
    const url = getRemoteUrl(remote);
    const repo = url ? parseRemoteUrl(url) : undefined;
    if (repo) return repo;
  }

  return undefined;
}

function getRemoteUrl(remote: string): string | undefined {
  try {
    return execFileSync("git", ["remote", "get-url", remote], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function listRemotes(): string[] {
  try {
    return execFileSync("git", ["remote"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split(/\r?\n/)
      .map((remote) => remote.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function parseNwo(
  nwo: string,
  source: "flag" | "env",
): RepoContext | undefined {
  const parts = nwo.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
  return { owner: parts[0], name: parts[1], nwo, source };
}

function parseRemoteUrl(url: string): RepoContext | undefined {
  // Match against the configured host (defaults to github.com), so remotes on a
  // GitHub Enterprise host such as git.example.com resolve too.
  const host = escapeRegExp(resolveHost());
  // SSH: git@<host>:OWNER/NAME.git
  const sshMatch = url.match(
    new RegExp(`(?:^|@|/)${host}[:/]([^/]+)/([^/]+?)(?:\\.git)?$`),
  );
  if (sshMatch) {
    const owner = sshMatch[1];
    const name = sshMatch[2];
    return { owner, name, nwo: `${owner}/${name}`, source: "git" };
  }
  // HTTPS: https://<host>/OWNER/NAME.git
  const httpsMatch = url.match(
    new RegExp(`(?:^|@|/)${host}/([^/]+)/([^/]+?)(?:\\.git)?$`),
  );
  if (httpsMatch) {
    const owner = httpsMatch[1];
    const name = httpsMatch[2];
    return { owner, name, nwo: `${owner}/${name}`, source: "git" };
  }
  return undefined;
}
