import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const cli = fileURLToPath(new URL("../../dist/bin/gh-axi.js", import.meta.url));
const fixture = fileURLToPath(
  new URL("../fixtures/redacted-fallback-gh.mjs", import.meta.url),
);
const credential = "synthetic-fallback-credential-never-use";

describe("safe diagnostic classification through the compiled CLI", () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "gh-axi-safe-fallback-"));
    const fakeGh = join(dir, "gh");
    copyFileSync(fixture, fakeGh);
    chmodSync(fakeGh, 0o755);
    env = {
      ...process.env,
      GH_BIN: fakeGh,
      GH_CONFIG_DIR: dir,
      GH_DEBUG: "api",
      AXI_DEBUG: "1",
    };
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function run(args: string[]) {
    const result = spawnSync(process.execPath, [cli, ...args], {
      env,
      encoding: "utf8",
      timeout: 10000,
    });
    expect((result.stdout + result.stderr).includes(credential)).toBe(false);
    return result;
  }

  it("keeps issueType fallback working without exposing its upstream diagnostics", () => {
    const result = run(["issue", "view", "206", "--repo", "octo/fixture"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Safe fallback issue");
    expect(result.stdout).toContain("octo/fixture");
    expect(result.stdout).not.toContain("client_secret");
    expect(result.stdout).not.toContain("temp_clone_token");
  });

  it("keeps not-found classification without echoing failure bodies", () => {
    const result = run(["issue", "view", "404", "--repo", "octo/fixture"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("code: NOT_FOUND");
    expect(result.stdout).toContain("diagnostics withheld");
    expect(result.stdout).not.toContain("password");
  });

  it("keeps the project's duplicate-field guidance without echoing diagnostics", () => {
    const result = run([
      "project",
      "field-create",
      "1",
      "--name",
      "Priority",
      "--data-type",
      "TEXT",
      "--owner",
      "octo",
    ]);
    expect(result.status).toBe(2);
    expect(result.stdout).toContain("Priority");
    expect(result.stdout).toContain("already exists");
    expect(result.stdout).not.toContain("private_key");
  });
});
