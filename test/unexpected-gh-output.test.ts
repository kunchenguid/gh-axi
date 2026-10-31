import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const cli = join(repoRoot, "dist/bin/gh-axi.js");
const fakeGhSource = fileURLToPath(
  new URL("./fixtures/non-json-gh.mjs", import.meta.url),
);
const secret = "SECRET-TOKEN-ghp_abc123";
const output = `<html>${secret} proxy page</html>\n`;

describe("unexpected gh output", () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gh-axi-non-json-"));
    const fakeGh = join(dir, "gh");
    copyFileSync(fakeGhSource, fakeGh);
    chmodSync(fakeGh, 0o755);
    env = {
      ...process.env,
      GH_BIN: fakeGh,
      GH_AXI_DISABLE_HOOKS: "1",
      GH_AXI_FAKE_OUTPUT: output,
    };
    delete env.GH_REPO;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it.each([
    ["JSON", ["issue", "list", "--repo", "octo/repo"]],
    [
      "comment",
      ["issue", "comment", "1", "--attach", "image.png", "--repo", "octo/repo"],
    ],
    [
      "PR comment",
      ["pr", "comment", "1", "--attach", "image.png", "--repo", "octo/repo"],
    ],
    ["stack", ["stack", "view"]],
  ])("does not echo malformed %s output", (_path, args) => {
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      env,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("code: UNKNOWN");
    expect(result.stdout).toContain(`${output.length} characters`);
    expect(result.stdout).toContain("HTML/XML");
    expect(result.stdout + result.stderr).not.toContain(secret);
    expect(result.stdout + result.stderr).not.toContain(output.trim());
    expect(result.stdout + result.stderr).not.toContain("proxy page");
  });

  it.each(["issue", "pr"])(
    "does not echo malformed %s comment output after a follow-up failure",
    (command) => {
      const commentOutput = `<html>${secret} https://github.com/octo/repo/issues/1#issuecomment-123</html>\n`;
      const result = spawnSync(
        process.execPath,
        [
          cli,
          command,
          "comment",
          "1",
          "--attach",
          "image.png",
          "--repo",
          "octo/repo",
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
          env: { ...env, GH_AXI_FAKE_OUTPUT: commentOutput },
        },
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("code: UNKNOWN");
      expect(result.stdout).toContain("Mutation succeeded at comment #123");
      expect(result.stdout).toContain(
        "Do not retry the mutation; inspect comment #123",
      );
      expect(result.stdout).toContain(`${commentOutput.length} characters`);
      expect(result.stdout).toContain("HTML/XML");
      expect(result.stdout + result.stderr).not.toContain(secret);
      expect(result.stdout + result.stderr).not.toContain(commentOutput.trim());
      expect(result.stdout + result.stderr).not.toContain("<html>");
    },
  );
});
