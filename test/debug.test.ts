import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ghExec } from "../src/gh.js";

const fakeGhSource = fileURLToPath(
  new URL("./fixtures/echo-argv-gh.mjs", import.meta.url),
);

describe("AXI_DEBUG argv trace", () => {
  let dir: string;
  let fakeGh: string;
  let previousGhBin: string | undefined;
  let previousDebug: string | undefined;
  let stderr: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gh-axi-debug-"));
    fakeGh = join(dir, "gh");
    copyFileSync(fakeGhSource, fakeGh);
    chmodSync(fakeGh, 0o755);
    previousGhBin = process.env["GH_BIN"];
    previousDebug = process.env["AXI_DEBUG"];
    process.env["GH_BIN"] = fakeGh;
    stderr = "";
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
      stderr += Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
      return true;
    }) as typeof process.stderr.write);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (previousGhBin === undefined) delete process.env["GH_BIN"];
    else process.env["GH_BIN"] = previousGhBin;
    if (previousDebug === undefined) delete process.env["AXI_DEBUG"];
    else process.env["AXI_DEBUG"] = previousDebug;
    rmSync(dir, { recursive: true, force: true });
  });

  /** Paste the traced command into a real shell, with the fake gh on PATH. */
  function replayInShell(line: string): string[] {
    const command = line.replace(/^\[axi-debug\] /, "");
    const out = execFileSync("sh", ["-c", command], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${dir}${delimiter}${process.env["PATH"]}` },
    });
    return JSON.parse(out) as string[];
  }

  it("writes one stderr line per gh call only when AXI_DEBUG=1, leaving stdout identical", async () => {
    const args = ["issue", "list", "--state", "open", "--json", "number"];

    delete process.env["AXI_DEBUG"];
    const quiet = await ghExec(args);
    expect(stderr).toBe("");

    process.env["AXI_DEBUG"] = "1";
    const traced = await ghExec(args);
    expect(traced).toBe(quiet);
    expect(stderr).toBe(
      "[axi-debug] gh issue list --state open --json number\n",
    );
  });

  it.each(["0", "true", "yes", "", " 1"])(
    "prints nothing for AXI_DEBUG=%j",
    async (value) => {
      process.env["AXI_DEBUG"] = value;
      await ghExec(["repo", "view"]);
      expect(stderr).toBe("");
    },
  );

  it("quotes only when needed and round-trips through a POSIX shell", async () => {
    const args = [
      "search",
      "issues",
      "login bug",
      "it's",
      "",
      "$HOME",
      "a*b",
      "`whoami`",
      'say "hi"',
      "line1\nline2",
      "--repo",
      "owner/name",
      "label:bug",
    ];
    process.env["AXI_DEBUG"] = "1";
    await ghExec(args);
    const line = stderr.trimEnd();
    expect(line).toContain(" --repo owner/name label:bug");
    expect(line).toContain(" 'login bug' ");
    expect(replayInShell(line)).toEqual(args);
  });

  it("masks header values in every -H/--header form, keeping the name", async () => {
    const args = [
      "api",
      "user",
      "-H",
      "Authorization: token ghp_secret1",
      "--header",
      "X-Api-Key: secret2",
      "--header=Authorization: Bearer secret3",
      "-HAuthorization: secret4",
      "-H=Cookie: secret5",
      "-H",
      "no-colon-secret6",
      "-f",
      "q=visible",
    ];
    process.env["AXI_DEBUG"] = "1";
    await ghExec(args);
    const line = stderr.trimEnd();
    expect(line).not.toMatch(/secret\d/);
    expect(replayInShell(line)).toEqual([
      "api",
      "user",
      "-H",
      "Authorization: ***",
      "--header",
      "X-Api-Key: ***",
      "--header=Authorization: ***",
      "-HAuthorization: ***",
      "-HCookie: ***",
      "-H",
      "***",
      "-f",
      "q=visible",
    ]);
  });

  it("includes --repo appended from a non-git repo context", async () => {
    process.env["AXI_DEBUG"] = "1";
    await ghExec(["issue", "list"], {
      owner: "o",
      name: "n",
      nwo: "o/n",
      source: "flag",
    });
    expect(stderr).toBe("[axi-debug] gh issue list --repo o/n\n");
  });
});
