import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main, TOP_HELP } from "../src/cli.js";

const packageVersion = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
) as { version: string };

function createStdout() {
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

describe("CLI entrypoint", () => {
  const originalDisableHooks = process.env.GH_AXI_DISABLE_HOOKS;

  beforeEach(() => {
    process.env.GH_AXI_DISABLE_HOOKS = "1";
  });

  afterEach(() => {
    process.exitCode = undefined;

    if (originalDisableHooks === undefined) {
      delete process.env.GH_AXI_DISABLE_HOOKS;
      return;
    }

    process.env.GH_AXI_DISABLE_HOOKS = originalDisableHooks;
  });

  it("prints top-level help through the real runtime", async () => {
    const output = createStdout();

    await main({ argv: ["--help"], stdout: output.stdout });

    expect(output.read()).toBe(TOP_HELP);
  });

  it.each(["-v", "-V", "--version"])(
    "prints %s through the real runtime",
    async (flag) => {
      const output = createStdout();

      await main({ argv: [flag], stdout: output.stdout });

      expect(output.read()).toBe(`${packageVersion.version}\n`);
    },
  );
});
