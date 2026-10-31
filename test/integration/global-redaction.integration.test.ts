import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveTestGh } from "../helpers/gh-bin.js";

const execute = promisify(execFile);
const cli = fileURLToPath(new URL("../../dist/bin/gh-axi.js", import.meta.url));
const gh = resolveTestGh();
const credential = "synthetic-global-credential-never-use";
const sensitiveKeys = [
  "temp_clone_token",
  "other_token",
  "token",
  "accessToken",
  "refresh-token",
  "client_secret",
  "SECRET",
  "secretValue",
  "password",
  "dbPasswordHash",
  "passwd",
  "passphrase",
  "private_key",
  "sshPrivateKey",
  "api_key",
  "accessKey",
  "signing_key",
  "authorization",
  "credentials",
  "jwt",
  "bearer",
  "private_key_pem",
  "token_value",
  "apiKeyValue",
  "auth_header",
];
const data = {
  full_name: "octo/unlisted-fixture",
  default_branch: "main",
  id: 789,
  nested: [
    {
      visible: "array-retained",
      ...Object.fromEntries(sensitiveKeys.map((key) => [key, credential])),
    },
  ],
  public_key: "safe-public-key",
  token_count: 42,
};

describe.skipIf(!gh)(
  "global field-based CLI response redaction (requires gh)",
  () => {
    let server: Server;
    let base: string;
    let config: string;
    let env: NodeJS.ProcessEnv;
    let requests = 0;

    beforeAll(async () => {
      config = mkdtempSync(join(tmpdir(), "gh-axi-global-redaction-"));
      env = {
        ...process.env,
        GH_BIN: gh!.path,
        GH_CONFIG_DIR: config,
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
        const url = new URL(request.url!, base);
        response.setHeader("Content-Type", "application/json");
        if (url.searchParams.has("fail")) response.statusCode = 500;
        if (url.searchParams.has("plain")) {
          response.setHeader("Content-Type", "text/plain");
          response.end("ordinary non-JSON output");
          return;
        }
        if (url.searchParams.has("malformed")) {
          response.end(`{"password":"${credential}", invalid JSON`);
          return;
        }
        if (url.searchParams.has("pages") && !url.searchParams.has("page")) {
          response.setHeader(
            "Link",
            `<${base}${url.pathname}?page=2>; rel="next"`,
          );
        }
        response.end(
          JSON.stringify(url.pathname === "/user/starred" ? [data] : data),
        );
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
      rmSync(config, { recursive: true, force: true });
    });

    async function run(path: string, flags: string[] = []) {
      try {
        return {
          ...(await execute(
            process.execPath,
            [cli, "api", `${base}${path}`, ...flags],
            { env, timeout: 10000 },
          )),
          status: 0,
        };
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
      expect((result.stdout + result.stderr).includes(credential)).toBe(false);
    }

    it("redacts the verifier's missed /user/starred --full case", async () => {
      const result = await run("/user/starred", ["--full"]);
      expectSafe(result);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("octo/unlisted-fixture");
      expect(result.stdout).toContain("array-retained");
    });

    it.each([[], ["--full"], ["--paginate"], ["--paginate", "--full"]])(
      "redacts nested objects and arrays on an unlisted endpoint with flags %j",
      async (...flags) => {
        const result = await run("/unlisted/response?pages=1", flags);
        expectSafe(result);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("array-retained");
        expect(result.stdout).toContain("safe-public-key");
        expect(result.stdout).toContain("42");
      },
    );

    it.each(sensitiveKeys)(
      "redacts %s before scalar jq projection",
      async (key) => {
        const result = await run("/unlisted/response", [
          "--jq",
          `.nested[0][${JSON.stringify(key)}]`,
          "--full",
        ]);
        expectSafe(result);
        expect(result.status).toBe(0);
      },
    );

    it("redacts before jq can rename or compose a sensitive value", async () => {
      const result = await run("/unlisted/response", [
        "--jq",
        '{branch: .default_branch, renamed: .nested[0].client_secret, composed: ("prefix-" + (.nested[0].password // "removed"))}',
        "--full",
      ]);
      expectSafe(result);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("branch: main");
      expect(result.stdout).toContain("composed: prefix-removed");
    });

    it("preserves a nonsensitive jq projection", async () => {
      const result = await run("/unlisted/response", [
        "--jq",
        ".default_branch",
      ]);
      expectSafe(result);
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("main");
    });

    it("refuses pre-redaction templates even on an unlisted endpoint", async () => {
      const before = requests;
      const result = await run("/unlisted/response", [
        "--template",
        "{{(index .nested 0).password}}",
      ]);
      expectSafe(result);
      expect(result.status).toBe(2);
      expect(result.stdout).toContain("--jq");
      expect(requests).toBe(before);
    });

    it("withholds debug/error response bodies on an unlisted endpoint", async () => {
      const result = await run("/unlisted/response?fail=1");
      expectSafe(result);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("diagnostics withheld");
    });

    it("does not leak a malformed JSON body through the raw fallback", async () => {
      const result = await run("/unlisted/response?malformed=1", ["--full"]);
      expectSafe(result);
      expect(result.status).not.toBe(0);
    });

    it("preserves ordinary non-JSON API output", async () => {
      const result = await run("/unlisted/response?plain=1", ["--full"]);
      expectSafe(result);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("ordinary non-JSON output");
    });
  },
);
