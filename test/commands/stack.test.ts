import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/gh.js", () => ({ ghRaw: vi.fn() }));

import { ghRaw } from "../../src/gh.js";
import { stackCommand, STACK_HELP } from "../../src/commands/stack.js";
import { AxiError, StackError } from "../../src/errors.js";

const mockedGhRaw = vi.mocked(ghRaw);

describe("stackCommand", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns help without invoking gh", async () => {
    expect(await stackCommand([])).toBe(STACK_HELP);
    expect(mockedGhRaw).not.toHaveBeenCalled();
  });

  it("always views the stack as JSON and renders TOON", async () => {
    mockedGhRaw.mockResolvedValue({
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({
        trunk: "main",
        currentBranch: "api",
        branches: [
          {
            name: "model",
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
    });

    const output = await stackCommand(["view"]);

    expect(mockedGhRaw).toHaveBeenCalledWith(["stack", "view", "--json"]);
    expect(output).toContain("current_branch: api");
    expect(output).toContain("branch_count: 2");
    expect(output).toContain("model,false,open,false,42");
    expect(output).toContain("api,true,local,true,null,null");
  });

  it("forces submit into auto mode", async () => {
    mockedGhRaw.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "✓ Pushed and synced 2 branches\n",
    });

    const output = await stackCommand(["submit", "--open"]);

    expect(mockedGhRaw).toHaveBeenCalledWith([
      "stack",
      "submit",
      "--open",
      "--auto",
    ]);
    expect(output).toContain("status: ok");
    expect(output).toContain("Pushed and synced 2 branches");
  });

  it("forces merge confirmation and requires a target", async () => {
    await expect(stackCommand(["merge", "--squash"])).rejects.toBeInstanceOf(
      AxiError,
    );
    mockedGhRaw.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "Merged stack\n",
    });

    await stackCommand(["merge", "42", "--squash"]);

    expect(mockedGhRaw).toHaveBeenCalledWith([
      "stack",
      "merge",
      "42",
      "--squash",
      "--yes",
    ]);
  });

  it("rejects interactive forms before invoking gh", async () => {
    await expect(stackCommand(["init"])).rejects.toBeInstanceOf(AxiError);
    await expect(stackCommand(["checkout"])).rejects.toBeInstanceOf(AxiError);
    await expect(stackCommand(["add"])).rejects.toBeInstanceOf(AxiError);
    expect(mockedGhRaw).not.toHaveBeenCalled();
  });

  it("allows message-driven add and validates staging flags", async () => {
    mockedGhRaw.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "Created branch\n",
    });

    await stackCommand(["add", "-Am", "Add API"]);

    expect(mockedGhRaw).toHaveBeenCalledWith([
      "stack",
      "add",
      "-Am",
      "Add API",
    ]);
    await expect(stackCommand(["add", "--all", "api"])).rejects.toThrow(
      /require --message/,
    );
  });

  it("reports a non-interactive sync abort distinctly", async () => {
    mockedGhRaw.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "ℹ Sync aborted — no changes were made\n",
    });

    const output = await stackCommand(["sync"]);

    expect(output).toContain("status: aborted");
  });

  it("reports successful syncs with failed steps as partial", async () => {
    mockedGhRaw.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr:
        "⚠ Push failed — branches may need force push after rebase\n✓ Branches synced\n",
    });

    const output = await stackCommand(["sync"]);

    expect(output).toContain("status: partial");
    expect(output).toContain("Push failed");
  });

  it("reports unmarked git push diagnostics as partial", async () => {
    mockedGhRaw.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr:
        "error: failed to push some refs to 'https://github.com/o/r.git'\nhint: Updates were rejected because the remote contains work you do not have\n",
    });

    const output = await stackCommand(["push"]);

    expect(output).toContain("status: partial");
    expect(output).toContain("failed to push some refs");
  });

  it("does not read an echoed commit subject as a partial failure", async () => {
    mockedGhRaw.mockResolvedValue({
      exitCode: 0,
      stdout: "[api 1a2b3c4] fix: could not parse dates\n",
      stderr: '✓ Added commit "fix: could not parse dates" to api\n',
    });

    const output = await stackCommand([
      "add",
      "-A",
      "-m",
      "fix: could not parse dates",
    ]);

    expect(output).toContain("status: ok");
  });

  it("rejects a zero navigation distance", async () => {
    await expect(stackCommand(["up", "0"])).rejects.toThrow(/positive integer/);
    await expect(stackCommand(["down", "0"])).rejects.toThrow(
      /positive integer/,
    );
    expect(mockedGhRaw).not.toHaveBeenCalled();
  });

  it("reports an unrecognized view payload instead of throwing a TypeError", async () => {
    mockedGhRaw.mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({ trunk: "main" }),
      stderr: "",
    });

    await expect(stackCommand(["view"])).rejects.toMatchObject({
      code: "UNKNOWN",
      message: expect.stringContaining("Unexpected gh stack output"),
    });
  });

  it("tolerates a branch whose pr carries no state", async () => {
    mockedGhRaw.mockResolvedValue({
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({
        branches: [
          {
            name: "api",
            isCurrent: true,
            isMerged: false,
            isQueued: false,
            needsRebase: false,
            pr: { number: 7 },
          },
        ],
      }),
    });

    const output = await stackCommand(["view"]);

    expect(output).toContain("trunk: null");
    expect(output).toContain("api,true,local,false,7,null");
  });

  it("does not report upstream warnings as clean success", async () => {
    mockedGhRaw.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr:
        "⚠ the base branch uses a merge queue; ignoring the merge method\n",
    });

    const output = await stackCommand(["merge", "42"]);

    expect(output).toContain("status: warning");
  });

  it("preserves stack exit codes and recovery guidance", async () => {
    mockedGhRaw.mockResolvedValue({
      exitCode: 3,
      stdout: "",
      stderr: "rebase conflict in src/a.ts\n",
    });

    try {
      await stackCommand(["rebase"]);
      expect.fail("expected StackError");
    } catch (error) {
      expect(error).toBeInstanceOf(StackError);
      expect((error as StackError).exitCode).toBe(3);
      expect((error as StackError).suggestions.join(" ")).toContain(
        "--continue",
      );
    }
  });

  it("uses fresh-rebase guidance after sync restores a conflict", async () => {
    mockedGhRaw.mockResolvedValue({
      exitCode: 3,
      stdout: "  Run `gh stack rebase` to resolve conflicts interactively.\n",
      stderr:
        "✗ Conflict detected rebasing api onto model\n✓ All branches restored\n",
    });

    try {
      await stackCommand(["sync"]);
      expect.fail("expected StackError");
    } catch (error) {
      expect(error).toMatchObject({
        message: expect.stringContaining("All branches restored"),
        suggestions: [expect.stringContaining("stack rebase`")],
      });
      expect((error as StackError).suggestions.join(" ")).not.toContain(
        "--continue",
      );
    }
  });

  it("uses reconciliation guidance for checkout composition conflicts", async () => {
    mockedGhRaw.mockResolvedValue({
      exitCode: 3,
      stdout: "Local: model <- api\nRemote: model <- ui\n",
      stderr: "local stack composition differs from remote\n",
    });

    await expect(stackCommand(["checkout", "42"])).rejects.toMatchObject({
      suggestions: [expect.stringContaining("unstack --local")],
    });
  });

  it("accepts equals-form values that begin with a dash", async () => {
    mockedGhRaw.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "Created branch\n",
    });

    await stackCommand(["add", "--message=- fix API"]);

    expect(mockedGhRaw).toHaveBeenCalledWith([
      "stack",
      "add",
      "--message=- fix API",
    ]);
  });

  it("suggests installing a missing extension", async () => {
    mockedGhRaw.mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: 'unknown command "stack" for "gh"\n',
    });

    await expect(stackCommand(["view"])).rejects.toMatchObject({
      suggestions: [
        expect.stringContaining("gh extension install github/gh-stack"),
      ],
    });
  });

  it("rejects unknown flags and subcommands", async () => {
    await expect(stackCommand(["view", "--short"])).rejects.toThrow(
      /Unsupported/,
    );
    await expect(stackCommand(["switch"])).rejects.toThrow(/Unknown/);
  });
});
