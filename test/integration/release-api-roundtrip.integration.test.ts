import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const cli = join(repoRoot, "bin", "gh-axi.ts");
const fakeGh = fileURLToPath(
  new URL("../fixtures/stateful-gh.mjs", import.meta.url),
);

type FakeState = {
  latestTag: string;
  fallbackLatestTag: string;
  releases: Array<{
    id: number;
    tag_name: string;
    name: string;
    prerelease: boolean;
    draft: boolean;
  }>;
};

function initialState(): FakeState {
  return {
    latestTag: "v0.9.0",
    fallbackLatestTag: "v0.9.0",
    releases: [
      {
        id: 1,
        tag_name: "v1.0.0",
        name: "Version 1 prerelease",
        prerelease: true,
        draft: false,
      },
      {
        id: 2,
        tag_name: "v0.9.0",
        name: "Version 0.9",
        prerelease: false,
        draft: false,
      },
    ],
  };
}

describe("CLI release and API state round-trips", () => {
  let dir: string;
  let stateFile: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gh-axi-stateful-gh-"));
    stateFile = join(dir, "state.json");
    writeFileSync(stateFile, JSON.stringify(initialState()), "utf8");
    const fakeBin = join(dir, "gh");
    copyFileSync(fakeGh, fakeBin);
    chmodSync(fakeBin, 0o755);
    env = {
      ...process.env,
      GH_AXI_FAKE_STATE: stateFile,
      PATH: `${dir}${delimiter}${process.env.PATH ?? ""}`,
    };
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function runCli(...args: string[]): string {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", cli, ...args, "-R", "octo/repo"],
      { cwd: repoRoot, encoding: "utf8", env },
    );
    expect(result.status, result.stderr || result.stdout).toBe(0);
    return result.stdout;
  }

  function readRelease(tag = "v1.0.0"): string {
    return runCli("api", `/repos/octo/repo/releases/tags/${tag}`);
  }

  function readLatest(): string {
    return runCli("api", "/repos/octo/repo/releases/latest");
  }

  it("promotes a prerelease and reads it back as repository latest", () => {
    runCli("release", "edit", "v1.0.0", "--prerelease=false", "--latest");

    expect(readRelease()).toContain("prerelease: false");
    expect(readLatest()).toContain("tag_name: v1.0.0");
  });

  it("demotes latest and reads back the persisted latest release", () => {
    runCli("release", "edit", "v1.0.0", "--prerelease=false", "--latest");
    runCli("release", "edit", "v1.0.0", "--latest=false");

    expect(readRelease()).toContain("prerelease: false");
    expect(readLatest()).toContain("tag_name: v0.9.0");
  });

  it("sets prerelease true and reads back the persisted release", () => {
    runCli("release", "edit", "v1.0.0", "--prerelease=false");
    runCli("release", "edit", "v1.0.0", "--prerelease");

    expect(readRelease()).toContain("prerelease: true");
  });

  it("persists an API PATCH for a subsequent API GET", () => {
    runCli(
      "api",
      "PATCH",
      "/repos/octo/repo/releases/1",
      "--field",
      "name=Version 1 stable",
      "--field",
      "prerelease=false",
    );

    const release = runCli("api", "/repos/octo/repo/releases/1");
    expect(release).toContain("name: Version 1 stable");
    expect(release).toContain("prerelease: false");
  });
});
