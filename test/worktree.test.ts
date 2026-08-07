import { execFileSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { baseBranchNeedsExplicitRepo } from "../src/worktree.js";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(execFileSync);

describe("baseBranchNeedsExplicitRepo", () => {
  beforeEach(() => {
    mockedExecFileSync.mockReset();
  });

  it("detects a base branch owned by another worktree", () => {
    mockedExecFileSync
      .mockReturnValueOnce("/repo/feature\n")
      .mockReturnValueOnce(
        "worktree /repo/main\0HEAD abc\0branch refs/heads/main\0\0" +
          "worktree /repo/feature\0HEAD def\0branch refs/heads/feature\0\0",
      );

    expect(baseBranchNeedsExplicitRepo("main")).toBe(true);
  });

  it("keeps local mode when only the current worktree owns the base", () => {
    mockedExecFileSync
      .mockReturnValueOnce("/repo/main\n")
      .mockReturnValueOnce(
        "worktree /repo/main\0HEAD abc\0branch refs/heads/main\0\0",
      );

    expect(baseBranchNeedsExplicitRepo("main")).toBe(false);
  });

  it("fails safe when worktree state cannot be inspected", () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error("git unavailable");
    });

    expect(baseBranchNeedsExplicitRepo("main")).toBe(true);
  });
});
