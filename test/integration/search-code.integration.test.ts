import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { decode } from "@toon-format/toon";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const cli = join(repoRoot, "dist/bin/gh-axi.js");
const fixture = fileURLToPath(
  new URL("../fixtures/non-json-gh.mjs", import.meta.url),
);

describe("compiled search code", () => {
  let dir: string;
  let fakeGh: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gh-axi-search-code-"));
    fakeGh = join(dir, "gh");
    copyFileSync(fixture, fakeGh);
    chmodSync(fakeGh, 0o755);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("shows the repository nameWithOwner for a code search result", () => {
    const result = spawnSync(
      process.execPath,
      [cli, "search", "code", "function"],
      {
        cwd: dir,
        encoding: "utf8",
        env: {
          ...process.env,
          GH_BIN: fakeGh,
          GH_REPO: undefined,
          GH_AXI_DISABLE_HOOKS: "1",
          GH_AXI_FAKE_OUTPUT: JSON.stringify([
            {
              path: "src/main.ts",
              repository: {
                id: "R_1",
                isFork: false,
                isPrivate: false,
                nameWithOwner: "octo/repo",
                url: "https://github.com/octo/repo",
              },
              textMatches: [{ type: "FileContent" }],
            },
          ]),
        },
      },
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(decode(result.stdout)).toMatchObject({
      results: [{ path: "src/main.ts", repo: "octo/repo", matches: 1 }],
    });
  });
});
