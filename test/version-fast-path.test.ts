import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const builtBin = join(repoRoot, "dist", "bin", "gh-axi.js");
const registerHook = fileURLToPath(
  new URL("./fixtures/module-trace-register.mjs", import.meta.url),
);

const packageVersion = (
  JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
  ) as { version: string }
).version;

type Run = { stdout: string; modules: string[] };

function runBin(args: string[]): Run {
  const dir = mkdtempSync(join(tmpdir(), "gh-axi-trace-"));
  const traceFile = join(dir, "trace.txt");
  writeFileSync(traceFile, "", "utf8");
  try {
    const stdout = execFileSync(
      process.execPath,
      ["--import", registerHook, builtBin, ...args],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          GH_AXI_MODULE_TRACE_FILE: traceFile,
        },
      },
    );
    const modules = readFileSync(traceFile, "utf8")
      .split("\n")
      .filter((line) => line.length > 0);
    return { stdout, modules };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("--version fast path", () => {
  beforeAll(() => {
    execFileSync("npm", ["run", "build"], { cwd: repoRoot, stdio: "ignore" });
  }, 120_000);

  it.each(["-v", "-V", "--version"])(
    "prints the package version for %s and exits 0",
    (flag) => {
      // execFileSync throws on a non-zero exit, so reaching the assertion
      // already proves exit code 0.
      expect(runBin([flag]).stdout).toBe(`${packageVersion}\n`);
    },
  );

  it("does not load the heavy command graph", () => {
    const { modules } = runBin(["--version"]);

    expect(modules.some((url) => url.endsWith("/dist/src/version.js"))).toBe(
      true,
    );
    expect(
      modules.some((url) => url.includes("axi-sdk-js/dist/fast-path.js")),
    ).toBe(true);

    expect(modules.filter((url) => url.endsWith("/dist/src/cli.js"))).toEqual(
      [],
    );
    expect(
      modules.filter((url) => url.includes("/dist/src/commands/")),
    ).toEqual([]);
    expect(modules.filter((url) => url.includes("@toon-format"))).toEqual([]);
  });

  it("negative control: a real command path does load the heavy command graph", () => {
    // Proves the trace probe above would actually catch a regression.
    const { modules } = runBin(["--help"]);

    expect(modules.some((url) => url.endsWith("/dist/src/cli.js"))).toBe(true);
    expect(modules.some((url) => url.includes("/dist/src/commands/"))).toBe(
      true,
    );
    expect(modules.some((url) => url.includes("@toon-format"))).toBe(true);
  });
});
