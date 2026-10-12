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
  function replayInShell(line: string, shell = "sh"): string[] {
    const command = line.replace(/^\[axi-debug\] /, "");
    const out = execFileSync(shell, ["-c", command], {
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

  it("keeps an argument with control characters on one line via $'...'", async () => {
    const args = [
      "issue",
      "create",
      "--body",
      "line1\nline2\tit's a \\path\r\x01\x7f end",
    ];
    process.env["AXI_DEBUG"] = "1";
    await ghExec(args);
    expect(stderr.endsWith("\n")).toBe(true);
    expect(stderr.indexOf("\n")).toBe(stderr.length - 1);
    // Replays through sh when it accepts $'...' (e.g. macOS sh, dash >= 0.5.12), else bash.
    const shAcceptsAnsiC =
      execFileSync("sh", ["-c", "printf %s $'a\\nb'"], {
        encoding: "utf8",
      }) === "a\nb";
    const shell = shAcceptsAnsiC ? "sh" : "bash";
    expect(replayInShell(stderr.trimEnd(), shell)).toEqual(args);
  });

  it("ends each escape after three octal digits, even before hex-digit text", async () => {
    const args = ["issue", "create", "--body", "line1\n'abc'\x017"];
    process.env["AXI_DEBUG"] = "1";
    await ghExec(args);
    expect(stderr).toBe(
      "[axi-debug] gh issue create --body $'line1\\n\\047abc\\047\\0017'\n",
    );
    const shAcceptsAnsiC =
      execFileSync("sh", ["-c", "printf %s $'a\\nb'"], {
        encoding: "utf8",
      }) === "a\nb";
    expect(
      replayInShell(stderr.trimEnd(), shAcceptsAnsiC ? "sh" : "bash"),
    ).toEqual(args);
  });

  it("never lets body text run when a shell lacks $'...' support", async () => {
    const body = "x\n';printf AXI_REPLAY_PROOF;#";
    process.env["AXI_DEBUG"] = "1";
    await ghExec(["issue", "create", "--body", body]);
    // Simulate a shell without $'...': the body becomes a plain '...' word.
    const line = stderr.trimEnd().replace("$'", "'");
    const command = line.replace(/^\[axi-debug\] /, "");
    const out = execFileSync("sh", ["-c", command], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${dir}${delimiter}${process.env["PATH"]}` },
    });
    // stdout is only the fake gh's one JSON line (the body is echoed inside
    // it); printf running as its own command would add text outside it.
    const [echoed, ...rest] = out.split("\n");
    expect(rest.join("\n")).toBe("");
    const argv = JSON.parse(echoed) as string[];
    expect(argv.slice(0, 3)).toEqual(["issue", "create", "--body"]);
    expect(argv).toHaveLength(4);
    expect(argv[3]).not.toContain("'");
  });

  it("skips other api flag values when finding headers", async () => {
    process.env["AXI_DEBUG"] = "1";
    await ghExec([
      "api",
      "user",
      "--field",
      "-H",
      "--header",
      "Authorization: token secret",
    ]);
    expect(stderr).not.toContain("secret");
    expect(replayInShell(stderr.trimEnd())).toEqual([
      "api",
      "user",
      "--field",
      "-H",
      "--header",
      "Authorization: ***",
    ]);
  });

  it("traces an api --template value starting with -H unchanged", async () => {
    const args = ["api", "user", "--template", "-Hotfix: {{.}}"];
    process.env["AXI_DEBUG"] = "1";
    await ghExec(args);
    expect(replayInShell(stderr.trimEnd())).toEqual(args);
  });

  it("traces header-like values of non-api commands unmasked", async () => {
    const args = [
      "issue",
      "create",
      "--title",
      "-Hotfix: crash",
      "--body",
      "-H",
    ];
    process.env["AXI_DEBUG"] = "1";
    await ghExec(args);
    expect(stderr).not.toContain("***");
    expect(replayInShell(stderr.trimEnd())).toEqual(args);
  });

  it("still masks an api --header value", async () => {
    process.env["AXI_DEBUG"] = "1";
    await ghExec(["api", "user", "--header", "Authorization: x"]);
    expect(stderr).toBe(
      "[axi-debug] gh api user --header 'Authorization: ***'\n",
    );
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
