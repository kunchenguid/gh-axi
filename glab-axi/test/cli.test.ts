import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("../src/glab.js", () => ({
  glabJson: vi.fn(),
  glabExec: vi.fn(),
}));

import { glabJson, glabExec } from "../src/glab.js";
import { main } from "../src/cli.js";

const mockedGlabJson = vi.mocked(glabJson);
const mockedGlabExec = vi.mocked(glabExec);

/** Collect what the CLI writes instead of letting it reach the real stdout. */
function captureStdout(): { write: (chunk: string) => boolean; text: () => string } {
  const chunks: string[] = [];
  return {
    write: (chunk: string) => {
      chunks.push(chunk);
      return true;
    },
    text: () => chunks.join(""),
  };
}

describe("main", () => {
  let previousExitCode: number | string | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
    previousExitCode = process.exitCode;
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
  });

  it("refuses an unparseable -R instead of targeting the cwd project", async () => {
    const stdout = captureStdout();
    await main({ argv: ["mr", "close", "42", "-R", "my group/b"], stdout });

    expect(stdout.text()).toContain("code: VALIDATION_ERROR");
    expect(stdout.text()).toContain("-R/--repo");
    expect(process.exitCode).toBe(2);
    expect(mockedGlabJson).not.toHaveBeenCalled();
    expect(mockedGlabExec).not.toHaveBeenCalled();
  });
});
