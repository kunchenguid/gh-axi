/** Default GitLab host used when none is configured. */
export const DEFAULT_HOST = "gitlab.com";

/** An explicitly requested host. Absent when no --hostname flag was given. */
export interface HostContext {
  value: string;
}

/**
 * Resolve the effective GitLab host.
 * Priority: explicit --hostname flag > GITLAB_HOST env > gitlab.com.
 *
 * The resolved host feeds two places: the child `glab` process (via the
 * GITLAB_HOST env var, which the child inherits) and the URLs glab-axi parses
 * or builds. A GitLab project's identity is (host, full path, number); there
 * is no fixed owner/repo pair, so the host is data, never a constant.
 */
export function resolveHost(flagValue?: string): string {
  if (flagValue) return flagValue;
  const envHost = process.env["GITLAB_HOST"];
  if (envHost) return envHost;
  return DEFAULT_HOST;
}

/** Escape a host so it can be embedded literally in a RegExp. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
