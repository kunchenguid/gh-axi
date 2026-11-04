import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const cli = join(repoRoot, "dist/bin/gh-axi.js");
const fakeGhSource = fileURLToPath(
  new URL("./fixtures/home-gh.mjs", import.meta.url),
);
const secret = "synthetic-private-token";
const issue = {
  number: 17,
  title: "Visible issue",
  state: "OPEN",
  author: { login: "octo" },
};
const pr = {
  number: 23,
  title: "Visible PR",
  author: { login: "octo" },
  reviewDecision: "APPROVED",
};
type Response = Record<string, unknown>[] | string;

describe("home fetch results", () => {
  let dir: string;
  let fakeGh: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gh-axi-home-"));
    fakeGh = join(dir, "gh");
    copyFileSync(fakeGhSource, fakeGh);
    chmodSync(fakeGh, 0o755);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function home(issues: Response, prs: Response) {
    const result = spawnSync(process.execPath, [cli], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        GH_REPO: "octo/repo",
        GH_BIN: fakeGh,
        GH_AXI_DISABLE_HOOKS: "1",
        AXI_DEBUG: "0",
        GH_AXI_HOME_RESPONSES: JSON.stringify({ issue: issues, pr: prs }),
      },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("repo: octo/repo");
    expect(result.stdout + result.stderr).not.toContain(secret);
    expect(result.stderr).toBe("");
    return result.stdout;
  }

  it("reports zero only for successfully read empty lists", () => {
    const output = home([], []);
    expect(output).toContain("issues: 0 open");
    expect(output).toContain("prs: 0 open");
    expect(output).not.toContain("unknown");
  });

  it("preserves nonempty lists and full-list hints", () => {
    const output = home(
      [issue, { ...issue, number: 18 }, { ...issue, number: 19 }],
      [pr, { ...pr, number: 24 }, { ...pr, number: 25 }],
    );
    expect(output).toContain("Visible issue");
    expect(output).toContain("Visible PR");
    expect(output).toContain("approved");
    expect(output).toContain("Run `gh-axi issue list` for full issue list");
    expect(output).toContain("Run `gh-axi pr list` for full PR list");
    expect(output).not.toContain("0 open");
    expect(output).not.toContain("unknown");
  });

  describe.each([
    ["auth", `HTTP 401: Bad credentials ${secret}`],
    ["network", `dial tcp: network is unreachable ${secret}`],
    ["rate limit", `HTTP 403: API rate limit exceeded ${secret}`],
  ])("%s failures", (_kind, diagnostic) => {
    it.each([false, true])(
      "keeps a successful PR read, nonempty=%s",
      (nonempty) => {
        const output = home(diagnostic, nonempty ? [pr] : []);
        expect(output).toContain("issues: unknown (fetch failed)");
        expect(output).not.toContain("issues: 0 open");
        expect(output).not.toContain("prs: unknown");
        expect(output).toContain(nonempty ? "Visible PR" : "prs: 0 open");
      },
    );

    it.each([false, true])(
      "keeps a successful issue read, nonempty=%s",
      (nonempty) => {
        const output = home(nonempty ? [issue] : [], diagnostic);
        expect(output).toContain("prs: unknown (fetch failed)");
        expect(output).not.toContain("prs: 0 open");
        expect(output).not.toContain("issues: unknown");
        expect(output).toContain(nonempty ? "Visible issue" : "issues: 0 open");
      },
    );

    it("reports both failed reads as unknown", () => {
      const output = home(diagnostic, diagnostic);
      expect(output).toContain("issues: unknown (fetch failed)");
      expect(output).toContain("prs: unknown (fetch failed)");
      expect(output).not.toContain("0 open");
    });
  });
});
