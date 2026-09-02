/**
 * Live --attach upload through the public gh-axi CLI (`main`).
 *
 * Requires:
 *   - GH_AXI_TEST_REPO=owner/name pointing at a captain-owned test repo
 *     (never a product repo)
 *   - gh >= 2.99.0, via GH_BIN, worktree .tools/gh-2.99.0, or PATH
 *
 * Run:
 *   GH_AXI_TEST_REPO=you/gh-axi-test pnpm test test/integration/attach.integration.test.ts
 */
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../src/cli.js";
import {
  ATTACH_MIN_GH,
  attachSkipReason,
  resolveTestGh,
  versionAtLeast,
} from "../helpers/gh-bin.js";
import { withPng } from "../helpers/media.js";

const testRepo = process.env["GH_AXI_TEST_REPO"]?.trim();
const resolved = resolveTestGh();
const ghOk =
  resolved !== undefined && versionAtLeast(resolved.version, ATTACH_MIN_GH);
const live = Boolean(testRepo && ghOk);

const skipReason = !testRepo
  ? "SKIP-WITH-REASON: live --attach uploads need GH_AXI_TEST_REPO set to a captain-owned test repo (never a product repo)"
  : attachSkipReason(resolved);

function collectStdout() {
  let output = "";
  return {
    stdout: {
      write(chunk: string) {
        output += chunk;
      },
    },
    read() {
      return output;
    },
  };
}

describe.skipIf(!live)("live --attach upload via gh-axi CLI", () => {
  const previousBin = process.env["GH_BIN"];

  afterEach(() => {
    process.exitCode = undefined;
    if (previousBin === undefined) delete process.env["GH_BIN"];
    else process.env["GH_BIN"] = previousBin;
  });

  it("creates an issue with --attach and reports the asset URL", async () => {
    if (resolved) process.env["GH_BIN"] = resolved.path;

    await withPng(async (file) => {
      const title = `gh-axi attach parity ${Date.now()}`;
      const created = collectStdout();
      await main({
        argv: [
          "issue",
          "create",
          "--title",
          title,
          "--body",
          "attach parity live test",
          "--attach",
          `${file}#parity`,
          "-R",
          testRepo as string,
        ],
        stdout: created.stdout,
      });

      const stdout = created.read();
      expect(stdout).toContain("attachments");
      expect(stdout).toContain("image");
      expect(stdout).toMatch(/user-attachments\/assets\//);

      const numMatch = stdout.match(/number:\s*(\d+)/);
      expect(numMatch).not.toBeNull();
      const number = numMatch![1];

      const closed = collectStdout();
      await main({
        argv: ["issue", "close", number, "-R", testRepo as string],
        stdout: closed.stdout,
      });
      expect(closed.read()).toContain("closed");
    });
  });
});

describe("live --attach gate", () => {
  it(live ? "GH_AXI_TEST_REPO and gh >= 2.99.0 are set" : skipReason, () => {
    if (live) {
      expect(testRepo).toMatch(/[^/]+\/[^/]+/);
      expect(ghOk).toBe(true);
      return;
    }
    expect(skipReason.startsWith("SKIP-WITH-REASON:")).toBe(true);
  });
});
