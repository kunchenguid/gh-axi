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
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const cli = join(repoRoot, "dist", "bin", "gh-axi.js");
const fakeGhSource = fileURLToPath(
  new URL("../fixtures/pr-merge-head-gh.mjs", import.meta.url),
);
const head = "0123456789abcdef0123456789abcdef01234567";
const movedHead = "fedcba9876543210fedcba9876543210fedcba987";
const headForms = [
  ["space", ["--match-head-commit", head]],
  ["equals", [`--match-head-commit=${head}`]],
] as const;

describe("compiled pr merge --match-head-commit", () => {
  let dir: string;
  let fakeGh: string;
  let argvFile: string;

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

  function runCli(args: string[], expectedHead?: string) {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GH_BIN: fakeGh,
      GH_AXI_ARGV_FILE: argvFile,
      GH_AXI_EXPECTED_HEAD: expectedHead,
    };
    return spawnSync(
      process.execPath,
      [cli, args[0], "-R", "octo/repo", ...args.slice(1)],
      { cwd: repoRoot, encoding: "utf8", env },
    );
  }

  function ghArgv(): string[][] {
    if (!existsSync(argvFile)) return [];
    return readFileSync(argvFile, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[]);
  }

  function mergeArgv(): string[][] {
    return ghArgv().filter((args) => args[0] === "pr" && args[1] === "merge");
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
    ["space", ["--match-head-commit", head]],
    ["equals", [`--match-head-commit=${head}`]],
    ["missing", ["--match-head-commit"]],
    ["blank", ["--match-head-commit="]],
  ])("does not activate a %s head condition after --", (_form, flags) => {
    const result = runCli(["pr", "merge", "17", "--squash", "--", ...flags]);

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(mergeArgv()).toEqual([
      ["pr", "merge", "17", "--squash", "--repo", "octo/repo"],
    ]);
  });

  it.each(headForms)(
    "keeps the %s condition before -- without treating a positional as a duplicate",
    (_form, flags) => {
      const result = runCli(
        [
          "pr",
          "merge",
          "17",
          ...flags,
          "--",
          `--match-head-commit=${movedHead}`,
        ],
        head,
      );

      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(mergeArgv()).toEqual([
        [
          "pr",
          "merge",
          "17",
          "--match-head-commit",
          head,
          "--repo",
          "octo/repo",
        ],
      ]);
    },
  );

  it.each(["-R", "--repo", "--hostname"])(
    "rejects a valueless %s without swallowing -- and activating a condition",
    (contextFlag) => {
      const result = runCli([
        "pr",
        "merge",
        "17",
        "--squash",
        contextFlag,
        "--",
        "--match-head-commit",
        head,
      ]);

      expect(result.status, result.stderr || result.stdout).toBe(2);
      expect(result.stdout).toContain("code: VALIDATION_ERROR");
      expect(ghArgv()).toEqual([]);
    },
  );

  it("leaves repository-shaped positionals after -- out of context resolution", () => {
    const result = runCli([
      "pr",
      "merge",
      "17",
      "--",
      "--repo=other/repo",
      "--match-head-commit",
    ]);

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(mergeArgv()).toEqual([["pr", "merge", "17", "--repo", "octo/repo"]]);
  });

  it("lets non-merge commands handle positionals after --", () => {
    const result = runCli(["pr", "view", "17", "--", "--match-head-commit"]);

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(ghArgv()).toEqual([
      ["pr", "view", "17", "--json", expect.any(String), "--repo", "octo/repo"],
    ]);
  });

  it("lets non-merge commands reject an unsupported head condition", () => {
    const result = runCli(["pr", "view", "17", "--match-head-commit"]);

    expect(result.status, result.stderr || result.stdout).toBe(2);
    expect(result.stdout).toContain(
      "unknown flag for gh-axi pr view: --match-head-commit",
    );
    expect(result.stdout).toContain("code: VALIDATION_ERROR");
    expect(ghArgv()).toEqual([]);
  });

  it.each(headForms)(
    "preserves the %s head condition after a valueless subject",
    (_form, flags) => {
      const result = runCli(
        ["pr", "merge", "17", "--squash", "--subject", ...flags],
        head,
      );

      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(mergeArgv()).toEqual([
        [
          "pr",
          "merge",
          "17",
          "--squash",
          "--match-head-commit",
          head,
          "--repo",
          "octo/repo",
        ],
      ]);
    },
  );

  it("preserves the condition when parsing switches exposes a subject collision", () => {
    const result = runCli(
      [
        "pr",
        "merge",
        "17",
        "--subject",
        "--squash",
        `--match-head-commit=${head}`,
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
        "--match-head-commit",
        head,
        "--repo",
        "octo/repo",
      ],
    ]);
  });

  it.each(["--body", "--body-file"])(
    "rejects valueless %s before reading it or spawning gh",
    (bodyFlag) => {
      for (const [, flags] of headForms) {
        const result = runCli([
          "pr",
          "merge",
          "17",
          "--squash",
          bodyFlag,
          ...flags,
        ]);

        expect(result.status, result.stderr || result.stdout).toBe(2);
        expect(result.stdout).toContain("code: VALIDATION_ERROR");
        expect(result.stderr).toBe("");
        expect(result.stdout).toContain(`${bodyFlag} requires`);
        expect(ghArgv()).toEqual([]);
      }
    },
  );

  it.each(["-R", "--repo", "--hostname"])(
    "rejects a head condition consumed as a %s value before spawning gh",
    (contextFlag) => {
      for (const [, flags] of headForms) {
        const result = runCli([
          "pr",
          "merge",
          "17",
          "--squash",
          contextFlag,
          ...flags,
        ]);

        expect(result.status, result.stderr || result.stdout).toBe(2);
        expect(result.stdout).toContain("code: VALIDATION_ERROR");
        expect(result.stderr).toBe("");
        expect(result.stdout).toContain(
          "--match-head-commit cannot be used as a repository or hostname value",
        );
        expect(ghArgv()).toEqual([]);
      }
    },
  );

  it.each(["--subject", "--body", "-R", "--repo", "--hostname"])(
    "rejects a duplicate condition hidden behind %s before spawning gh",
    (consumer) => {
      const result = runCli([
        "pr",
        "merge",
        "17",
        "--match-head-commit",
        head,
        consumer,
        `--match-head-commit=${movedHead}`,
      ]);

      expect(result.status, result.stderr || result.stdout).toBe(2);
      expect(result.stdout).toContain("code: VALIDATION_ERROR");
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain(
        "--match-head-commit may only be given once",
      );
      expect(ghArgv()).toEqual([]);
    },
  );

  it("rejects a missing head value before context stripping can replace it", () => {
    const result = runCli([
      "pr",
      "merge",
      "17",
      "--match-head-commit",
      "--repo=octo/repo",
      head,
    ]);

    expect(result.status, result.stderr || result.stdout).toBe(2);
    expect(result.stdout).toContain("code: VALIDATION_ERROR");
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("--match-head-commit requires a value");
    expect(ghArgv()).toEqual([]);
  });

  it("preserves a numeric head value before the PR number and context flags", () => {
    const numericHead = "1234567890123456789012345678901234567890";
    const result = runCli(
      [
        "pr",
        "--hostname=github.example.com",
        "merge",
        "--match-head-commit",
        numericHead,
        "17",
        "--squash",
        "--subject",
        "Reviewed change",
        "--body",
        "Ready to merge",
      ],
      numericHead,
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(mergeArgv()).toEqual([
      [
        "pr",
        "merge",
        "17",
        "--squash",
        "--body",
        "Ready to merge",
        "--subject",
        "Reviewed change",
        "--match-head-commit",
        numericHead,
        "--repo",
        "octo/repo",
      ],
    ]);
  });

  it.each([
    ["--match-head-commit"],
    ["--match-head-commit="],
    ["--match-head-commit", "--auto"],
  ])("rejects malformed head condition %j before spawning gh", (...flags) => {
    const result = runCli(["pr", "merge", "17", ...flags]);

    expect(result.status, result.stderr || result.stdout).toBe(2);
    expect(result.stdout).toContain("code: VALIDATION_ERROR");
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("--match-head-commit requires a value");
    expect(ghArgv()).toEqual([]);
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

    expect(result.status, result.stderr || result.stdout).toBe(2);
    expect(result.stdout).toContain("code: VALIDATION_ERROR");
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(
      "--match-head-commit may only be given once",
    );
    expect(ghArgv()).toEqual([]);
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
