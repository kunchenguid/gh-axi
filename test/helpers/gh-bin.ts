import { existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ATTACH_MIN_GH_VERSION } from "../../src/attach.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export { ATTACH_MIN_GH_VERSION as ATTACH_MIN_GH };

export interface ResolvedGh {
  path: string;
  version: string;
}

export function parseGhVersion(text: string): string | undefined {
  const match = text.match(/gh version (\d+\.\d+\.\d+)/);
  return match?.[1];
}

export function versionAtLeast(actual: string, min: string): boolean {
  const a = actual.split(".").map((n) => Number(n));
  const b = min.split(".").map((n) => Number(n));
  for (let i = 0; i < 3; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return true;
}

function versionOf(bin: string): string | undefined {
  try {
    const out = execFileSync(bin, ["--version"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    return parseGhVersion(out);
  } catch {
    return undefined;
  }
}

function localToolsGh(): string | undefined {
  const root = join(repoRoot, ".tools", "gh-2.99.0");
  if (!existsSync(root)) return undefined;
  for (const entry of readdirSync(root)) {
    const candidate = join(root, entry, "bin", "gh");
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

/** GH_BIN, then worktree .tools/gh-2.99.0, then PATH `gh`. */
export function resolveTestGh(): ResolvedGh | undefined {
  const fromEnv = process.env["GH_BIN"]?.trim();
  const candidates = [fromEnv, localToolsGh(), "gh"].filter(
    (p): p is string => typeof p === "string" && p.length > 0,
  );
  for (const path of candidates) {
    const version = versionOf(path);
    if (version) return { path, version };
  }
  return undefined;
}

export function attachSkipReason(resolved: ResolvedGh | undefined): string {
  return `SKIP-WITH-REASON: --attach tests require gh >= ${ATTACH_MIN_GH_VERSION}; resolved ${resolved?.version ?? "none"} at ${resolved?.path ?? "(not found)"}. Set GH_BIN to a ${ATTACH_MIN_GH_VERSION}+ binary.`;
}
