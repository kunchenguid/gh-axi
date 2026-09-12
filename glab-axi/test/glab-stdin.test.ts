import { describe, it, expect, afterEach } from "vitest";
import { glabExec } from "../src/glab.js";

/**
 * Runs the real child process (no child_process mock, unlike glab.test.ts):
 * the defect under test is that the child's stdin pipe stays open, which only
 * a real spawn can show.
 */
describe("glabExec child stdin", () => {
  afterEach(() => {
    delete process.env["GLAB_BIN"];
  });

  it("closes the child's stdin so a glab path reading it cannot hang", async () => {
    // Stand in for a glab invocation that reads standard input (`--input -`,
    // `--field k=@-`); node is the one binary guaranteed to be present.
    process.env["GLAB_BIN"] = process.execPath;
    const output = await glabExec([
      "-e",
      "let n = 0; process.stdin.on('data', (c) => { n += c.length; }); process.stdin.on('end', () => process.stdout.write(`read:${n}`));",
    ]);
    expect(output).toBe("read:0");
  });
});
