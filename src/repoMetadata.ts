/** REST endpoints returning repository metadata, including lists and mutations. */
export function isRepositoryMetadataPath(path: string): boolean {
  let pathname: string;
  try {
    pathname = decodeURIComponent(
      new URL(path, "https://github.com/").pathname,
    );
  } catch {
    return false;
  }
  pathname = pathname.replace(/^\/api\/v3\//, "/").replace(/\/+$/, "");
  return (
    /^\/repos\/[^/]+\/[^/]+(?:\/(?:forks|generate|transfer))?$/.test(
      pathname,
    ) ||
    /^\/repositories(?:\/\d+(?:\/forks)?)?$/.test(pathname) ||
    /^\/(?:users|orgs)\/[^/]+\/repos$/.test(pathname) ||
    pathname === "/user/repos" ||
    pathname === "/search/repositories"
  );
}

export function isRepositoryMetadataRequest(args: string[]): boolean {
  return args[0] === "api" && isRepositoryMetadataPath(args[1] ?? "");
}

/** Runs in gh before user jq projections can erase or rename credential keys. */
export const REPOSITORY_METADATA_JQ =
  'walk(if type == "object" then with_entries(select(.key | endswith("_token") | not)) else . end)';

/** Also sanitize decoded output before compacting/collapsing, with no depth cap. */
export function omitRepositoryToken(key: string, value: unknown): unknown {
  return key.endsWith("_token") ? undefined : value;
}
