import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/gh.js", () => ({ ghRaw: vi.fn() }));

import { ghRaw } from "../../src/gh.js";
import { stackCommand, STACK_HELP } from "../../src/commands/stack.js";
import { AxiError } from "../../src/errors.js";

const mockedGhRaw = vi.mocked(ghRaw);

function success(stdout = "", stderr = "") {
  return { stdout, stderr, exitCode: 0 };
}

describe("stackCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedGhRaw.mockResolvedValue(success());
  });

  it("returns help without invoking gh", async () => {
    expect(await stackCommand([])).toBe(STACK_HELP);
    expect(mockedGhRaw).not.toHaveBeenCalled();
  });

  it("renders gh-stack JSON view as TOON and forces JSON mode", async () => {
    mockedGhRaw.mockResolvedValue(
      success(
        JSON.stringify({
          trunk: "main",
          currentBranch: "api",
          branches: [
            {
              name: "model",
              head: "abc",
              base: "def",
              isCurrent: false,
              isMerged: false,
              isQueued: false,
              needsRebase: false,
              pr: {
                number: 42,
                url: "https://github.com/o/r/pull/42",
                state: "OPEN",
              },
            },
            {
              name: "api",
              isCurrent: true,
              isMerged: false,
              isQueued: false,
              needsRebase: true,
            },
          ],
        }),
      ),
    );

    const result = await stackCommand(["view"]);

    expect(mockedGhRaw).toHaveBeenCalledWith(["stack", "view", "--json"]);
    expect(result).toContain("current_branch: api");
    expect(result).toContain("branch_count: 2");
    expect(result).toContain("https://github.com/o/r/pull/42");
    expect(result).toContain("needs_rebase");
    expect(result).toContain("stack submit");
  });

  it("rejects unsupported view flags before invoking gh", async () => {
    await expect(stackCommand(["view", "--short"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(mockedGhRaw).not.toHaveBeenCalled();
  });

  it("forces submit into auto mode", async () => {
    const result = await stackCommand(["submit", "--open"]);

    expect(mockedGhRaw).toHaveBeenCalledWith([
      "stack",
      "submit",
      "--open",
      "--auto",
    ]);
    expect(result).toContain("status: ok");
  });

  it("requires a merge target and forces confirmation", async () => {
    await expect(stackCommand(["merge"])).rejects.toBeInstanceOf(AxiError);
    await stackCommand(["merge", "42", "--squash"]);

    expect(mockedGhRaw).toHaveBeenCalledWith([
      "stack",
      "merge",
      "42",
      "--squash",
      "--yes",
    ]);

    await stackCommand(["merge", "43", "--yes"]);
    expect(mockedGhRaw).toHaveBeenLastCalledWith([
      "stack",
      "merge",
      "43",
      "--yes",
    ]);
  });

  it("requires explicit branches for init and checkout", async () => {
    await expect(stackCommand(["init"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(stackCommand(["checkout"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(mockedGhRaw).not.toHaveBeenCalled();
  });

  it("validates add staging flags and supports bundled -Am", async () => {
    await expect(stackCommand(["add", "-A"])).rejects.toThrow(
      /require --message/,
    );
    await stackCommand(["add", "-Am", "Add API", "api"]);

    expect(mockedGhRaw).toHaveBeenCalledWith([
      "stack",
      "add",
      "-Am",
      "Add API",
      "api",
    ]);
  });

  it("allows a message to generate the next branch name", async () => {
    await stackCommand(["add", "--message=Add API"]);

    expect(mockedGhRaw).toHaveBeenCalledWith([
      "stack",
      "add",
      "--message=Add API",
    ]);
  });

  it("rejects zero navigation distance", async () => {
    await expect(stackCommand(["up", "0"])).rejects.toThrow(/positive integer/);
    await expect(stackCommand(["down", "0"])).rejects.toThrow(
      /positive integer/,
    );
    expect(mockedGhRaw).not.toHaveBeenCalled();
  });

  it("rejects deferred interactive and human-only subcommands", async () => {
    for (const subcommand of ["modify", "switch", "alias", "feedback"]) {
      await expect(stackCommand([subcommand])).rejects.toThrow(
        `gh stack ${subcommand} directly`,
      );
    }
    expect(mockedGhRaw).not.toHaveBeenCalled();
  });

  it("preserves stdout and stderr in non-view results", async () => {
    mockedGhRaw.mockResolvedValue(
      success("https://github.com/o/r/pull/42\n", "Created PR #42\n"),
    );

    const result = await stackCommand(["submit"]);

    expect(result).toContain("https://github.com/o/r/pull/42");
    expect(result).toContain("Created PR #42");
  });

  it("reports malformed view output as a structured error", async () => {
    mockedGhRaw.mockResolvedValue(success(JSON.stringify({ trunk: "main" })));

    await expect(stackCommand(["view"])).rejects.toMatchObject({
      code: "UNKNOWN",
      message: expect.stringContaining("Unexpected gh stack output"),
    });
  });

  it("preserves stack exit codes and recovery suggestions", async () => {
    mockedGhRaw.mockResolvedValueOnce({
      stdout: "",
      stderr: "conflict while rebasing the stack\n",
      exitCode: 3,
    });

    await expect(stackCommand(["rebase"])).rejects.toMatchObject({
      exitCode: 3,
      code: "STACK_ERROR",
      suggestions: expect.arrayContaining([
        expect.stringContaining("--continue"),
      ]),
    });
  });

  it("suggests installing the extension when gh-stack is missing", async () => {
    mockedGhRaw.mockResolvedValue({
      stdout: "",
      stderr: 'unknown command "stack" for "gh"\n',
      exitCode: 1,
    });

    await expect(stackCommand(["view"])).rejects.toMatchObject({
      code: "EXTENSION_NOT_INSTALLED",
      suggestions: [
        expect.stringContaining("gh extension install github/gh-stack"),
      ],
    });
  });
});
