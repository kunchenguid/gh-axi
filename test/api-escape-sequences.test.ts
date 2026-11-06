import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const cli = fileURLToPath(new URL("../dist/bin/gh-axi.js", import.meta.url));
const fixture = fileURLToPath(
  new URL("./fixtures/escape-sequences-gh.mjs", import.meta.url),
);
const flag = "--allow-escape-sequences";
const endpoint = "/repos/octo/repo/actions/jobs/123/logs";

describe("api escape-sequence opt-in", () => {
  let dir: string;
  let gh: string;
  let argvFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gh-axi-escapes-"));
    gh = join(dir, "gh");
    argvFile = join(dir, "argv.json");
    copyFileSync(fixture, gh);
    chmodSync(gh, 0o755);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function run(args: string[]) {
    return spawnSync(process.execPath, [cli, "api", ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        GH_BIN: gh,
        GH_AXI_ARGV_FILE: argvFile,
        AXI_DEBUG: "1",
      },
    });
  }

  function argv(): string[] {
    return JSON.parse(readFileSync(argvFile, "utf8"));
  }

  it("preserves gh's safe refusal without the opt-in", () => {
    const result = run([endpoint, "--full"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain(`pass ${flag}`);
    expect(argv()).toEqual(["api", endpoint, "--method", "GET"]);
  });

  it.each([false, true])(
    "forwards the opt-in once and preserves full=%s output",
    (full) => {
      const result = run([flag, endpoint, flag, ...(full ? ["--full"] : [])]);
      expect(result.status).toBe(0);
      expect(argv()).toEqual(["api", endpoint, "--method", "GET", flag]);
      expect(result.stdout).toContain("api_response:");
      expect(result.stdout).toContain("Synthetic job log");
      expect(result.stdout).toContain(`truncated: ${!full}`);
      expect(result.stdout).toContain("x".repeat(full ? 4100 : 3900));
    },
  );

  it.each(["true", "false", "", "private-value"])(
    "rejects a valued boolean %j without echoing its value",
    (value) => {
      const result = run([endpoint, `${flag}=${value}`]);
      expect(result.status).not.toBe(0);
      expect(result.stdout + result.stderr).toContain(
        `${flag} does not take a value`,
      );
      if (value === "private-value")
        expect(result.stdout + result.stderr).not.toContain(value);
    },
  );

  it("keeps neighboring values, method, pagination and header redaction intact", () => {
    const result = run([
      "-X",
      "POST",
      endpoint,
      "--header",
      "Authorization: token synthetic-private",
      "--field",
      "name=value",
      "--paginate",
      flag,
    ]);
    expect(result.status).toBe(0);
    expect(argv()).toEqual([
      "api",
      endpoint,
      "--method",
      "POST",
      "--field",
      "name=value",
      "--header",
      "Authorization: token synthetic-private",
      "--paginate",
      flag,
    ]);
    expect(result.stderr).not.toContain("synthetic-private");
    expect(result.stderr).toContain("Authorization: ***");
  });

  it("does not reinterpret a neighboring flag value as an opt-in", () => {
    const result = run([endpoint, "--header", `${flag}=true`]);
    expect(result.status).not.toBe(0);
    expect(argv()).toEqual([
      "api",
      endpoint,
      "--method",
      "GET",
      "--header",
      `${flag}=true`,
    ]);
  });

  it("documents the opt-in in the CLI help used by the skill", () => {
    const result = run(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(flag);
  });
});
