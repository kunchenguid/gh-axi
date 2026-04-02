import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
vi.mock("../../src/gh.js", () => ({
  ghJson: vi.fn(),
  ghExec: vi.fn(),
  ghRaw: vi.fn(),
}));

import { ghJson } from "../../src/gh.js";
import { homeCommand } from "../../src/commands/home.js";
import type { RepoContext } from "../../src/context.js";

const mockedGhJson = vi.mocked(ghJson);

describe("homeCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not include bin or description header fields", async () => {
    mockedGhJson.mockResolvedValue([]);

    const result = await homeCommand([]);

    expect(result).not.toContain("bin:");
    expect(result).not.toContain("description:");
  });

  it("returns output with issues and prs sections", async () => {
    mockedGhJson.mockImplementation(async (args: string[]) => {
      if (args[0] === "issue") {
        return [
          {
            number: 1,
            title: "Bug report",
            state: "OPEN",
            author: { login: "alice" },
          },
          {
            number: 2,
            title: "Feature request",
            state: "OPEN",
            author: { login: "bob" },
          },
        ];
      }
      if (args[0] === "pr") {
        return [
          {
            number: 10,
            title: "Add feature",
            author: { login: "charlie" },
            reviewDecision: "APPROVED",
          },
        ];
      }
      return [];
    });

    const result = await homeCommand([], {
      owner: "octo",
      name: "repo",
      nwo: "octo/repo",
      source: "flag",
    });

    expect(result).toContain("issues");
    expect(result).toContain("Bug report");
    expect(result).toContain("prs");
    expect(result).toContain("Add feature");
    expect(result).not.toContain("runs");
    expect(mockedGhJson).toHaveBeenCalledTimes(2);
  });

  it("includes repo context when provided", async () => {
    mockedGhJson.mockResolvedValue([]);

    const ctx: RepoContext = {
      owner: "octo",
      name: "repo",
      nwo: "octo/repo",
      source: "flag",
    };
    const result = await homeCommand([], ctx);

    expect(result).toContain("octo/repo");
  });

  it("handles ghJson failures gracefully", async () => {
    mockedGhJson.mockRejectedValue(new Error("network error"));

    const result = await homeCommand([]);

    // Should return output with empty sections, not throw
    expect(result).toContain("issues");
    expect(result).toContain("prs");
  });

  it("works without repo context", async () => {
    mockedGhJson.mockResolvedValue([]);

    const result = await homeCommand([]);

    expect(result).toContain("issues: 0 open");
    expect(result).not.toContain("repo:");
  });

  it("includes truncation hints in help block when sections hit limit", async () => {
    mockedGhJson.mockImplementation(async (args: string[]) => {
      if (args[0] === "issue") {
        return [
          {
            number: 1,
            title: "Bug 1",
            state: "OPEN",
            author: { login: "alice" },
          },
          {
            number: 2,
            title: "Bug 2",
            state: "OPEN",
            author: { login: "bob" },
          },
          {
            number: 3,
            title: "Bug 3",
            state: "OPEN",
            author: { login: "charlie" },
          },
        ];
      }
      if (args[0] === "pr") {
        return [
          {
            number: 10,
            title: "PR 1",
            author: { login: "a" },
            reviewDecision: "APPROVED",
          },
          {
            number: 11,
            title: "PR 2",
            author: { login: "b" },
            reviewDecision: "APPROVED",
          },
          {
            number: 12,
            title: "PR 3",
            author: { login: "c" },
            reviewDecision: "APPROVED",
          },
        ];
      }
      return [];
    });

    const ctx: RepoContext = {
      owner: "octo",
      name: "repo",
      nwo: "octo/repo",
      source: "flag",
    };
    const result = await homeCommand([], ctx);

    expect(result).toMatch(/help\[.*\]:/);
    expect(result).toContain("gh-axi issue list");
    expect(result).toContain("gh-axi pr list");
  });

  it("omits truncation hints when sections are below limit", async () => {
    mockedGhJson.mockImplementation(async (args: string[]) => {
      if (args[0] === "issue") {
        return [
          {
            number: 1,
            title: "Bug",
            state: "OPEN",
            author: { login: "alice" },
          },
        ];
      }
      return [];
    });

    const result = await homeCommand([]);

    expect(result).not.toContain("gh-axi issue list");
    expect(result).not.toContain("gh-axi pr list");
  });

  it("shows definitive zero counts when all sections are empty", async () => {
    mockedGhJson.mockResolvedValue([]);

    const result = await homeCommand([]);

    expect(result).toContain("issues: 0 open");
    expect(result).toContain("prs: 0 open");
  });

  it("shows zero counts for empty sections alongside populated ones", async () => {
    mockedGhJson.mockImplementation(async (args: string[]) => {
      if (args[0] === "issue") {
        return [
          {
            number: 1,
            title: "Bug",
            state: "OPEN",
            author: { login: "alice" },
          },
        ];
      }
      return [];
    });

    const result = await homeCommand([]);

    expect(result).toContain("Bug");
    expect(result).not.toContain("issues: 0 open");
    expect(result).toContain("prs: 0 open");
  });

  it("does not show zero counts when sections have data", async () => {
    mockedGhJson.mockImplementation(async (args: string[]) => {
      if (args[0] === "issue")
        return [
          { number: 1, title: "Bug", state: "OPEN", author: { login: "a" } },
        ];
      if (args[0] === "pr")
        return [
          {
            number: 2,
            title: "Fix",
            author: { login: "b" },
            reviewDecision: "APPROVED",
          },
        ];
      return [];
    });

    const result = await homeCommand([]);

    expect(result).not.toContain("issues: 0 open");
    expect(result).not.toContain("prs: 0 open");
  });
});
