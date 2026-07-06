/** Default GitHub host used when none is configured. */
export const DEFAULT_HOST = "github.com";

export interface HostContext {
  value: string;
  source: "flag" | "env" | "default";
}

/**
 * Resolve the effective GitHub host.
 * Priority: explicit --hostname flag > GH_HOST env > github.com.
 *
 * The resolved host feeds two places: the child `gh` process (via the GH_HOST
 * env var, which the child inherits) and the URLs gh-axi parses or builds.
 */
export function resolveHost(flagValue?: string): string {
  if (flagValue) return flagValue;
  const envHost = process.env["GH_HOST"];
  if (envHost) return envHost;
  return DEFAULT_HOST;
}

/** Escape a host so it can be embedded literally in a RegExp. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
