import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const cli = join(repoRoot, "dist", "bin", "gh-axi.js");
const fakeGhSource = fileURLToPath(
  new URL("../fixtures/pr-merge-head-gh.mjs", import.meta.url),
);
const head = "0123456789abcdef0123456789abcdef01234567";
const movedHead = "fedcba9876543210fedcba9876543210fedcba987";

function build(): void {
  const result = spawnSync("npm", ["run", "build"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  expect(result.status, result.stderr || result.stdout).toBe(0);
}

describe("compiled pr merge --match-head-commit", () => {
  let dir: string;
  let fakeGh: string;
  let argvFile: string;

  beforeAll(build);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gh-axi-pr-merge-head-"));
    fakeGh = join(dir, "gh");
    argvFile = join(dir, "argv.jsonl");
    copyFileSync(fakeGhSource, fakeGh);
    chmodSync(fakeGh, 0o755);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  afterAll(build);

  function runCli(args: string[], expectedHead?: string) {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GH_BIN: fakeGh,
      GH_AXI_ARGV_FILE: argvFile,
    };
    if (expectedHead !== undefined) env.GH_AXI_EXPECTED_HEAD = expectedHead;
    return spawnSync(process.execPath, [cli, ...args, "-R", "octo/repo"], {
      cwd: repoRoot,
      encoding: "utf8",
      env,
    });
  }

  function mergeArgv(): string[][] {
    if (!existsSync(argvFile)) return [];
    return readFileSync(argvFile, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[]);
  }

  it("preserves an exact reviewed SHA with the selected method and target", () => {
    const result = runCli(
      [
        "pr",
        "merge",
        "17",
        "--squash",
        "--delete-branch",
        "--match-head-commit",
        head,
      ],
      head,
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(mergeArgv()).toEqual([
      [
        "pr",
        "merge",
        "17",
        "--squash",
        "--delete-branch",
        "--match-head-commit",
        head,
        "--repo",
        "octo/repo",
      ],
    ]);
  });

  it("leaves ordinary merge argv unchanged when no head condition is requested", () => {
    const result = runCli(["pr", "merge", "17", "--squash"]);

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(mergeArgv()).toEqual([
      ["pr", "merge", "17", "--squash", "--repo", "octo/repo"],
    ]);
  });

  it.each([
    ["--match-head-commit"],
    ["--match-head-commit="],
    ["--match-head-commit", "--auto"],
  ])("rejects malformed head condition %j before spawning gh", (...flags) => {
    const result = runCli(["pr", "merge", "17", ...flags]);

    expect(result.status).toBe(2);
    expect(result.stdout).toContain("--match-head-commit requires a value");
    expect(mergeArgv()).toEqual([]);
  });

  it("rejects repeated head conditions before spawning gh", () => {
    const result = runCli([
      "pr",
      "merge",
      "17",
      "--match-head-commit",
      head,
      "--match-head-commit",
      movedHead,
    ]);

    expect(result.status).toBe(2);
    expect(result.stdout).toContain(
      "--match-head-commit may only be given once",
    );
    expect(mergeArgv()).toEqual([]);
  });

  it("passes nonempty head values unchanged to gh for enforcement", () => {
    const result = runCli(
      ["pr", "merge", "17", "--match-head-commit", "not-a-sha"],
      head,
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "reviewed commit does not match current pull request head",
    );
    expect(mergeArgv()).toEqual([
      [
        "pr",
        "merge",
        "17",
        "--match-head-commit",
        "not-a-sha",
        "--repo",
        "octo/repo",
      ],
    ]);
  });

  it("propagates the no-network child refusal when the reviewed head moved", () => {
    const result = runCli(
      ["pr", "merge", "17", "--match-head-commit", head],
      movedHead,
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "reviewed commit does not match current pull request head",
    );
    expect(mergeArgv()).toEqual([
      ["pr", "merge", "17", "--match-head-commit", head, "--repo", "octo/repo"],
    ]);
  });
});
