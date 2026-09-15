import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const cli = join(repoRoot, "dist", "bin", "gh-axi.js");
const fakeGhSource = fileURLToPath(
  new URL("../fixtures/issue-view-repo-gh.mjs", import.meta.url),
);
const fakeGitSource = fileURLToPath(
  new URL("../fixtures/issue-view-repo-git.mjs", import.meta.url),
);

type TraceEntry = {
  kind: "issue-view" | "graphql";
  repo: string | null;
  args: string[];
};

describe("compiled issue view repository context", () => {
  let dir: string;
  let traceFile: string;
  let gitTraceFile: string;
  let baseEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gh-axi-issue-view-repo-"));
    traceFile = join(dir, "gh-argv.jsonl");
    gitTraceFile = join(dir, "git-argv.jsonl");
    const fakeGh = join(dir, "gh");
    const fakeGit = join(dir, "git");
    const home = join(dir, "home");
    mkdirSync(home);
    copyFileSync(fakeGhSource, fakeGh);
    copyFileSync(fakeGitSource, fakeGit);
    chmodSync(fakeGh, 0o755);
    chmodSync(fakeGit, 0o755);
    baseEnv = {
      ...process.env,
      HOME: home,
      PATH: `${dir}${delimiter}${process.env.PATH ?? ""}`,
      GH_BIN: fakeGh,
      GH_AXI_DISABLE_HOOKS: "1",
      GH_AXI_FAKE_TRACE: traceFile,
      GH_AXI_FAKE_GIT_TRACE: gitTraceFile,
      GH_AXI_FAKE_ORIGIN: "gamma/origin",
    };
    delete baseEnv.GH_REPO;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function runCli(args: string[], ghRepo?: string) {
    const env = { ...baseEnv };
    if (ghRepo) env.GH_REPO = ghRepo;
    return spawnSync(process.execPath, [cli, "issue", "view", "123", ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      env,
    });
  }

  function traces(): TraceEntry[] {
    return readFileSync(traceFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as TraceEntry);
  }

  it.each([
    [
      "--repo",
      ["--repo", "alpha/explicit"],
      "shadow/environment",
      "alpha/explicit",
      false,
    ],
    ["GH_REPO", [], "beta/environment", "beta/environment", false],
    ["git origin", [], undefined, "gamma/origin", true],
  ] as const)(
    "renders the repository resolved from %s",
    (_route, args, ghRepo, expectedRepo, usesGit) => {
      const result = runCli([...args], ghRepo);

      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(result.stdout).toContain(`  repo: ${expectedRepo}`);
      expect(traces().map(({ kind, repo }) => ({ kind, repo }))).toEqual([
        { kind: "issue-view", repo: expectedRepo },
        { kind: "graphql", repo: expectedRepo },
      ]);
      expect(existsSync(gitTraceFile)).toBe(usesGit);
    },
  );
});
