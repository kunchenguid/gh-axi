import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const builtBin = fileURLToPath(
  new URL("../dist/bin/gh-axi.js", import.meta.url),
);
const fixture = fileURLToPath(
  new URL("./fixtures/search-empty-gh.mjs", import.meta.url),
);
const families = ["issues", "prs", "repos", "commits", "code"];

function run(type: string, query: string[], flags = ["--owner", "octo"]) {
  const dir = mkdtempSync(join(tmpdir(), "gh-axi-search-query-"));
  try {
    const gh = join(dir, "gh");
    const log = join(dir, "argv.jsonl");
    copyFileSync(fixture, gh);
    chmodSync(gh, 0o755);
    writeFileSync(log, "");
    const result = spawnSync(
      process.execPath,
      [builtBin, "search", type, ...query, ...flags],
      {
        cwd: dir,
        encoding: "utf8",
        env: {
          ...process.env,
          GH_BIN: gh,
          GH_AXI_SEARCH_ARGV: log,
          GH_REPO: "ambient/repo",
        },
      },
    );
    expect(result.error).toBeUndefined();
    const calls = readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[]);
    return { ...result, calls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe.each(families)("compiled search %s query validation", (type) => {
  it.each([
    ["is:open author:@me", ["issues", "prs", "commits"]],
    ["review-requested:@me\tcreated:>=2026-01-01", ["issues", "prs"]],
    ['label:"help wanted" author:@me', ["issues", "prs"]],
    ['label:"say \\"hello\\" author:literal" is:open', ["issues", "prs"]],
    ["is:open\n-author:bot", ["issues", "prs", "commits"]],
    ["bug is:open author:@me", ["issues", "prs", "commits"]],
    ["repo:octo/repo user:octo", families],
    ["is:open org:cli", ["issues", "prs", "repos", "commits"]],
    ["stars:>10 topic:cli", ["repos"]],
    ["author-name:Alice committer-email:alice@example.com", ["commits"]],
    ["path:src extension:ts", ["code"]],
    ["repo:octo/repo -repo:octo/other", families],
  ] as [string, string[]][])(
    "validates combined terms %j for its family",
    (query, rejectIn) => {
      const result = run(type, [query]);
      // Oracle: GitHub's documented qualifiers for each search family. A global
      // colon matcher rejects the ordinary-text cases in the other families.
      if (!rejectIn.includes(type)) {
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("count: 0");
        expect(result.calls).toHaveLength(1);
        expect(result.calls[0].slice(-2)).toEqual(["--", query]);
        return;
      }
      expect(result.status).not.toBe(0);
      expect(result.stdout + result.stderr).toContain("VALIDATION_ERROR");
      expect(result.stdout + result.stderr).toContain("separate arguments");
      expect(result.stdout + result.stderr).toContain("'is:open' 'author:@me'");
      expect(result.calls).toEqual([]);
    },
  );

  it.each([
    ["is:open", "author:@me"],
    ["login bug"],
    ['label:"help wanted"'],
    ['label:"is:open author:@me"'],
    ['"is:open author:@me"'],
    ['label:"say \\"hello\\" author:literal"'],
    ["https://example.com/a:b https://example.com/c:d"],
    ["mailto:alice@example.com tel:12345"],
    ["urn:isbn:9780140328721 data:text/plain,hello"],
    ["mailto:alice@example.com repo:octo/repo"],
    ["repo:octo/repo tel:12345"],
    ["C++ :: namespace::member"],
    ["error: failed at 12:30"],
    ["std::vector std::string"],
    ["std::vector author:@me"],
    ["author:@me std::vector"],
    ["it's a login bug"],
    ["repo:octo/repo", "is:open"],
    ["user:octo", "org:example"],
  ])("preserves argv and legitimate empty results for %j", (...query) => {
    const result = run(type, query);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("count: 0");
    expect(result.calls).toHaveLength(1);
    const argv = result.calls[0];
    expect(argv.slice(argv.indexOf("--") + 1)).toEqual(query);
    expect(argv.slice(0, 2)).toEqual(["search", type]);
    expect(argv).toContain("--owner");
  });

  it("preserves an explicit scope", () => {
    const flags =
      type === "repos" ? ["--owner", "octo"] : ["--repo", "octo/repo"];
    const result = run(type, ["is:open", "author:@me"], flags);
    expect(result.status).toBe(0);
    expect(result.calls[0]).toContain(flags[1]);
  });

  it("does not validate flag values as positional queries", () => {
    const result = run(type, ["bug"], ["--owner", "is:open author:@me"]);
    expect(result.status).toBe(0);
    expect(result.calls[0]).toContain("is:open author:@me");
  });

  it("keeps explicit query scopes without adding the ambient repository", () => {
    const result = run(type, ["repo:octo/repo"], []);
    expect(result.status).toBe(0);
    expect(result.calls[0]).not.toContain("ambient/repo");
    expect(result.calls[0].slice(-2)).toEqual(["--", "repo:octo/repo"]);
  });
});

it("documents separate qualifiers and quoted values in compiled help", () => {
  const result = spawnSync(
    process.execPath,
    [builtBin, "search", "prs", "--help"],
    {
      encoding: "utf8",
    },
  );
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("'is:open' 'author:@me'");
  expect(result.stdout).toContain('label:"help wanted"');
});
