import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
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
  afterEach(() => {
    process.exitCode = undefined;
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
