import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ghExec, ghRaw } from "../src/gh.js";

const fakeGhSource = fileURLToPath(
  new URL("./fixtures/live-stderr-gh.mjs", import.meta.url),
);
const approvalLine = "Vault approval required for test request\n";
const errorLine = "HTTP 403: Forbidden\n";

async function waitForLiveStderr(
  observed: Promise<void>,
  ms: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("timed out waiting for live stderr")),
      ms,
    );
  });
  try {
    await Promise.race([observed, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

describe("shared gh runner live stderr", () => {
  let dir: string;
  let releaseFile: string;
  let previousGhBin: string | undefined;
  let previousReleaseFile: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gh-axi-live-stderr-"));
    releaseFile = join(dir, "release");
    const fakeGh = join(dir, "gh");
    copyFileSync(fakeGhSource, fakeGh);
    chmodSync(fakeGh, 0o755);

    previousGhBin = process.env["GH_BIN"];
    previousReleaseFile = process.env["GH_AXI_FAKE_RELEASE"];
    process.env["GH_BIN"] = fakeGh;
    process.env["GH_AXI_FAKE_RELEASE"] = releaseFile;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (previousGhBin === undefined) delete process.env["GH_BIN"];
    else process.env["GH_BIN"] = previousGhBin;
    if (previousReleaseFile === undefined)
      delete process.env["GH_AXI_FAKE_RELEASE"];
    else process.env["GH_AXI_FAKE_RELEASE"] = previousReleaseFile;
    rmSync(dir, { recursive: true, force: true });
  });

  it("forwards each stderr chunk before exit while retaining and mapping it", async () => {
    let forwarded = "";
    let approvalObserved: () => void = () => {};
    const observed = new Promise<void>((resolve) => {
      approvalObserved = resolve;
    });
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
      forwarded += Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
      if (forwarded.includes(approvalLine)) approvalObserved();
      return true;
    }) as typeof process.stderr.write);

    let settled = false;
    const pending = ghRaw(["api", "test"]).finally(() => {
      settled = true;
    });

    try {
      await waitForLiveStderr(observed, 2_000);
    } catch (error) {
      writeFileSync(releaseFile, "release", "utf8");
      await pending;
      throw error;
    }
    expect(settled).toBe(false);

    writeFileSync(releaseFile, "release", "utf8");
    const result = await pending;
    expect(result).toEqual({
      stdout: "fake stdout retained\n",
      stderr: approvalLine + errorLine,
      exitCode: 7,
    });
    expect(forwarded).toBe(result.stderr);

    forwarded = "";
    await expect(ghExec(["api", "test"])).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Insufficient permissions for this action",
    });
    expect(forwarded).toBe(approvalLine + errorLine);
  });
});
