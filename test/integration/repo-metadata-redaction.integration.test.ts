import { execFile } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveTestGh } from "../helpers/gh-bin.js";

const execute = promisify(execFile);
const cli = fileURLToPath(new URL("../../dist/bin/gh-axi.js", import.meta.url));
const diagnosticFixture = fileURLToPath(
  new URL("../fixtures/repo-metadata-diagnostics-gh.mjs", import.meta.url),
);
const gh = resolveTestGh();
const fakeCredential = "synthetic-repository-credential-never-use";
const fakeNestedCredential = "synthetic-nested-credential-never-use";
const metadata = {
  id: 123,
  full_name: "octo/fixture",
  default_branch: "main",
  private: true,
  temp_clone_token: fakeCredential,
  other_token: { value: fakeNestedCredential },
  nested: [{ keep: "nested-visible", access_token: fakeNestedCredential }],
  deep: Array.from({ length: 12 }).reduce<unknown>((child) => ({ child }), {
    keep: "deep-visible",
    refresh_token: fakeNestedCredential,
  }),
};

// Exercise the real gh formatter against a loopback-only synthetic upstream.
// No GitHub request, real credential, repository mutation, or auth-store write.
describe.skipIf(!gh)("repository metadata CLI redaction (requires gh)", () => {
  let server: Server;
  let base: string;
  let dir: string;
  let env: NodeJS.ProcessEnv;
  let requests = 0;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "gh-axi-metadata-"));
    env = {
      ...process.env,
      GH_BIN: gh!.path,
      GH_CONFIG_DIR: dir,
      GH_TOKEN: "synthetic-auth-only",
      GITHUB_TOKEN: "synthetic-auth-only",
      GH_ENTERPRISE_TOKEN: "synthetic-auth-only",
      GITHUB_ENTERPRISE_TOKEN: "synthetic-auth-only",
      GH_DEBUG: "api",
      AXI_DEBUG: "1",
      GH_PROMPT_DISABLED: "1",
    };
    delete env.GH_REPO;
    delete env.GH_HOST;
    server = createServer((request, response) => {
      requests++;
      response.setHeader("Content-Type", "application/json");
      const url = new URL(request.url!, base);
      if (url.searchParams.has("fail")) response.statusCode = 500;
      if (url.searchParams.has("pages") && !url.searchParams.has("page")) {
        response.setHeader(
          "Link",
          `<${base}${url.pathname}?page=2>; rel="next"`,
        );
      }
      response.end(JSON.stringify(metadata));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("no loopback port");
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    rmSync(dir, { recursive: true, force: true });
  });

  async function run(path: string, args: string[] = [], extraEnv = {}) {
    try {
      const result = await execute(
        process.execPath,
        [cli, "api", path, ...args],
        {
          env: { ...env, ...extraEnv },
          timeout: 10_000,
        },
      );
      return { ...result, status: 0 };
    } catch (error) {
      const result = error as Error & {
        stdout: string;
        stderr: string;
        code: number;
      };
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        status: result.code,
      };
    }
  }

  function expectSafe(result: { stdout: string; stderr: string }) {
    const output = result.stdout + result.stderr;
    // Boolean assertions keep even the synthetic credential out of failure logs.
    expect(output.includes(fakeCredential)).toBe(false);
    expect(output.includes(fakeNestedCredential)).toBe(false);
  }

  it.each([[], ["--full"], ["--paginate"], ["--paginate", "--full"]])(
    "redacts recursively with output flags %j, retaining ordinary metadata",
    async (...flags) => {
      const result = await run(`${base}/repos/octo/fixture?pages=1`, flags);
      expectSafe(result);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("octo/fixture");
      expect(result.stdout).toContain("main");
      expect(result.stdout).toContain("nested-visible");
      expect(result.stdout).toContain("deep-visible");
    },
  );

  it.each([
    ".temp_clone_token",
    ".nested[0].access_token",
    "{renamed: .temp_clone_token, branch: .default_branch}",
    '"prefix-" + (.temp_clone_token // "redacted")',
  ])("redacts before the user jq projection %s", async (query) => {
    const result = await run(`${base}/repos/octo/fixture`, [
      "--jq",
      query,
      "--full",
    ]);
    expectSafe(result);
    expect(result.status).toBe(0);
    if (query.includes("branch:"))
      expect(result.stdout).toContain("branch: main");
    if (query.startsWith('"prefix-"'))
      expect(result.stdout.trim()).toBe("prefix-redacted");
  });

  it("preserves a nonsensitive scalar jq projection", async () => {
    const result = await run(`${base}/repos/octo/fixture`, [
      "--jq",
      ".default_branch",
    ]);
    expectSafe(result);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("main");
  });

  it("rejects metadata templates before requesting upstream", async () => {
    const before = requests;
    const result = await run(`${base}/repos/octo/fixture`, [
      "--template",
      "{{.temp_clone_token}}",
    ]);
    expectSafe(result);
    expect(result.status).toBe(2);
    expect(result.stdout).toContain("--template");
    expect(result.stdout).toContain("--jq");
    expect(requests).toBe(before);
  });

  it("preserves templates on other endpoints", async () => {
    const result = await run(`${base}/repos/octo/fixture/issues/1`, [
      "--template",
      "{{.default_branch}}",
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("main");
  });

  it.each([
    "/repositories/123",
    "/repositories",
    "/user/repos",
    "/users/octo/repos",
    "/orgs/octo/repos",
    "/search/repositories",
    "/repos/octo/fixture/forks",
    "/repos/octo/fixture/generate",
    "/repos/octo/fixture/transfer",
    "/api/v3/repos/octo/fixture/",
  ])("protects repository-returning endpoint %s", async (path) => {
    const result = await run(`${base}${path}`, ["--full"]);
    expectSafe(result);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("octo/fixture");
  });

  it("withholds upstream failure bodies and debug diagnostics", async () => {
    const result = await run(`${base}/repos/octo/fixture?fail=1`);
    expectSafe(result);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("diagnostics withheld");
  });

  it.each([0, 7])(
    "withholds chunked pending diagnostics and retains child exit %i",
    async (status) => {
      const fakeGh = join(dir, "diagnostic-gh");
      copyFileSync(diagnosticFixture, fakeGh);
      chmodSync(fakeGh, 0o755);
      const result = await run(`${base}/repos/octo/fixture`, [], {
        GH_BIN: fakeGh,
        GH_AXI_METADATA_RESPONSE: JSON.stringify(metadata),
        GH_AXI_METADATA_EXIT: String(status),
      });
      expectSafe(result);
      expect(result.status).toBe(status);
      if (status === 0) expect(result.stdout).toContain("octo/fixture");
      else expect(result.stdout).toContain("diagnostics withheld");
    },
  );
});
