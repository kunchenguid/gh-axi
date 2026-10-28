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
import { decode } from "@toon-format/toon";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const cli = join(repoRoot, "dist", "bin", "gh-axi.js");
const fixture = fileURLToPath(
  new URL("../fixtures/pr-view-fields-gh.mjs", import.meta.url),
);
const head = "0123456789abcdef0123456789abcdef01234567";
const credential = "synthetic-token-must-not-appear";

describe("compiled pr view --fields", () => {
  let dir: string;
  let fakeGh: string;
  let argvFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gh-axi-pr-view-fields-"));
    fakeGh = join(dir, "gh");
    argvFile = join(dir, "argv.jsonl");
    copyFileSync(fixture, fakeGh);
    chmodSync(fakeGh, 0o755);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function runCli(flags: string[], repoSource: "flag" | "env" = "flag") {
    return spawnSync(
      process.execPath,
      [
        cli,
        "pr",
        "view",
        "42",
        ...(repoSource === "flag" ? ["-R", "octo/repo"] : []),
        ...flags,
      ],
      {
        cwd: dir,
        encoding: "utf8",
        env: {
          ...process.env,
          GH_BIN: fakeGh,
          GH_AXI_ARGV_FILE: argvFile,
          GH_REPO: repoSource === "env" ? "octo/repo" : undefined,
          GH_TOKEN: credential,
          GITHUB_TOKEN: credential,
        },
      },
    );
  }

  function ghArgv(): string[][] {
    if (!existsSync(argvFile)) return [];
    return readFileSync(argvFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
  }

  it.each(["flag", "env"] as const)(
    "selects only number/title and preserves %s repo context",
    (repoSource) => {
      const result = runCli(["--fields", "number,title"], repoSource);
      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(decode(result.stdout)).toEqual({
        pull_request: { number: 42, title: "Selected PR" },
      });
      expect(ghArgv()).toEqual([
        ["pr", "view", "42", "--json", "number,title", "--repo", "octo/repo"],
      ]);
      expect(
        result.stdout + result.stderr + JSON.stringify(ghArgv()),
      ).not.toContain(credential);
    },
  );

  it("preserves head SHA, nested review metadata and nulls without truncation", () => {
    const result = runCli(["--fields=headRefOid,reviews,milestone"]);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(decode(result.stdout)).toEqual({
      pull_request: {
        headRefOid: head,
        reviews: [
          {
            id: "PRR_1",
            author: { login: "reviewer" },
            state: "APPROVED",
            body: "Review text\n".repeat(100),
            submittedAt: "2026-10-01T12:00:00Z",
            commit: { oid: head },
          },
        ],
        milestone: null,
      },
    });
    expect(ghArgv()[0]).toEqual([
      "pr",
      "view",
      "42",
      "--json",
      "headRefOid,reviews,milestone",
      "--repo",
      "octo/repo",
    ]);
  });

  it("trims and deduplicates field names", () => {
    const result = runCli(["--fields", " title,number,title "]);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(ghArgv()[0][4]).toBe("title,number");
    expect(decode(result.stdout)).toEqual({
      pull_request: { title: "Selected PR", number: 42 },
    });
  });

  it.each([
    ["--fields"],
    ["--fields="],
    ["--fields", " "],
    ["--fields=,"],
    ["--fields=title,"],
    ["--fields=title,,number"],
    ["--fields=notAField"],
    ["--fields=__proto__"],
    ["--fields=constructor"],
    ["--fields=title", "--fields=number"],
    ["--fields", "--comments"],
    ...["--comments", "--reviews", "--checks", "--full"].map((mode) => [
      "--fields=title",
      mode,
    ]),
  ])("refuses invalid selection locally: %j", (...flags) => {
    const result = runCli(flags);
    expect(result.status).toBe(2);
    expect(result.stdout + result.stderr).toContain("VALIDATION_ERROR");
    expect(result.stdout + result.stderr).not.toContain(credential);
    expect(ghArgv()).toEqual([]);
  });
});
