import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/gh.js", () => ({
  ghJson: vi.fn(),
  ghExec: vi.fn(),
  ghRaw: vi.fn(),
}));

import { ghJson, ghExec, ghRaw } from "../../src/gh.js";
import { issueCommand, ISSUE_HELP } from "../../src/commands/issue.js";
import { AxiError } from "../../src/errors.js";
import type { RepoContext } from "../../src/context.js";

const mockedGhJson = vi.mocked(ghJson);
const mockedGhExec = vi.mocked(ghExec);
const mockedGhRaw = vi.mocked(ghRaw);

function mockTypeQueryOnce(nodes: Array<{ id: string; name: string }>): void {
  mockedGhRaw.mockResolvedValueOnce({
    stdout: JSON.stringify({
      data: { repository: { issueTypes: { nodes } } },
    }),
    stderr: "",
    exitCode: 0,
  });
}

function mockTypeMutationOnce(): void {
  mockedGhRaw.mockResolvedValueOnce({
    stdout: JSON.stringify({
      data: { updateIssue: { issue: { id: "I_node" } } },
    }),
    stderr: "",
    exitCode: 0,
  });
}

const ctx: RepoContext = {
  owner: "octo",
  name: "repo",
  nwo: "octo/repo",
  source: "flag",
};

describe("issueCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("router", () => {
    it("returns help when --help is passed", async () => {
      const result = await issueCommand(["--help"], ctx);
      expect(result).toContain(ISSUE_HELP);
    });

    it("returns help when no subcommand is given", async () => {
      const result = await issueCommand([], ctx);
      expect(result).toContain(ISSUE_HELP);
    });

    it("returns error for unknown subcommand (not throw)", async () => {
      const result = await issueCommand(["unknown"], ctx);
      expect(result).toContain("Unknown issue subcommand: unknown");
    });
  });

  describe("list", () => {
    it("returns list with count", async () => {
      mockedGhJson.mockResolvedValue([
        {
          number: 1,
          title: "Bug report",
          state: "OPEN",
          author: { login: "alice" },
          createdAt: "2024-01-01T00:00:00Z",
        },
        {
          number: 2,
          title: "Feature request",
          state: "OPEN",
          author: { login: "bob" },
          createdAt: "2024-01-02T00:00:00Z",
        },
      ]);

      const result = await issueCommand(["list"], ctx);

      expect(result).toContain("count: 2");
      expect(result).toContain("Bug report");
      expect(result).toContain("Feature request");
    });

    it("uses default compact --json fields when --fields is not passed", async () => {
      mockedGhJson.mockResolvedValue([]);
      await issueCommand(["list"], ctx);

      const callArgs = mockedGhJson.mock.calls[0][0] as string[];
      const jsonIdx = callArgs.indexOf("--json");
      const jsonValue = callArgs[jsonIdx + 1];
      // Default fields should NOT include body, closedAt, etc.
      expect(jsonValue).not.toContain("body");
      expect(jsonValue).not.toContain("closedAt");
      expect(jsonValue).toContain("number");
      expect(jsonValue).toContain("title");
    });

    it("extends --json and schema when --fields is passed", async () => {
      mockedGhJson.mockResolvedValue([
        {
          number: 1,
          title: "Bug",
          state: "OPEN",
          author: { login: "alice" },
          createdAt: "2024-01-01T00:00:00Z",
          body: "details here",
          labels: [{ name: "bug" }],
        },
      ]);

      const result = await issueCommand(
        ["list", "--fields", "body,labels"],
        ctx,
      );

      // The gh --json arg should include the extra fields
      const callArgs = mockedGhJson.mock.calls[0][0] as string[];
      const jsonIdx = callArgs.indexOf("--json");
      const jsonValue = callArgs[jsonIdx + 1];
      expect(jsonValue).toContain("body");
      expect(jsonValue).toContain("labels");

      // Output should contain the extra field data
      expect(result).toContain("details here");
      expect(result).toContain("bug");
    });

    it("throws VALIDATION_ERROR for unknown --fields", async () => {
      await expect(
        issueCommand(["list", "--fields", "nonexistent"], ctx),
      ).rejects.toThrow(AxiError);

      try {
        await issueCommand(["list", "--fields", "nonexistent"], ctx);
      } catch (e) {
        expect((e as AxiError).code).toBe("VALIDATION_ERROR");
        expect((e as AxiError).message).toContain("nonexistent");
      }
    });
  });

  describe("view", () => {
    it("returns detail", async () => {
      mockedGhJson.mockResolvedValue({
        number: 42,
        title: "Critical bug",
        state: "OPEN",
        author: { login: "alice" },
        createdAt: "2024-01-01T00:00:00Z",
        body: "Some issue body",
      });

      const result = await issueCommand(["view", "42"], ctx);

      expect(result).toContain("42");
      expect(result).toContain("Critical bug");
      expect(result).toContain("open");
      expect(result).toContain("alice");
    });

    it("includes issueType in the --json field list and renders type", async () => {
      mockedGhJson.mockResolvedValue({
        number: 42,
        title: "Critical bug",
        state: "OPEN",
        author: { login: "alice" },
        createdAt: "2024-01-01T00:00:00Z",
        body: "Some issue body",
        issueType: { name: "Bug" },
      });

      const result = await issueCommand(["view", "42"], ctx);

      const callArgs = mockedGhJson.mock.calls[0][0] as string[];
      const jsonIdx = callArgs.indexOf("--json");
      expect(callArgs[jsonIdx + 1]).toContain("issueType");
      expect(result).toContain("type: Bug");
    });

    it("renders type as none when no issueType is set", async () => {
      mockedGhJson.mockResolvedValue({
        number: 42,
        title: "Critical bug",
        state: "OPEN",
        author: { login: "alice" },
        createdAt: "2024-01-01T00:00:00Z",
        body: "Some issue body",
        issueType: null,
      });

      const result = await issueCommand(["view", "42"], ctx);
      expect(result).toContain("type: none");
    });

    it("falls back when gh does not support the issueType field", async () => {
      mockedGhJson.mockRejectedValueOnce(
        new AxiError('unknown JSON field: "issueType"', "UNKNOWN"),
      );
      mockedGhJson.mockResolvedValueOnce({
        number: 42,
        title: "Critical bug",
        state: "OPEN",
        author: { login: "alice" },
        createdAt: "2024-01-01T00:00:00Z",
        body: "Some issue body",
      });

      const result = await issueCommand(["view", "42"], ctx);
      expect(result).toContain("Critical bug");
      expect(result).not.toContain("type: none");
    });

    it("omits help suggestions from detail view", async () => {
      mockedGhJson.mockResolvedValue({
        number: 42,
        title: "Bug",
        state: "OPEN",
        author: { login: "alice" },
        createdAt: "2024-01-01T00:00:00Z",
        body: "body",
      });
      const result = await issueCommand(["view", "42"], ctx);
      expect(result).not.toMatch(/^help\[/m);
    });
  });

  describe("create", () => {
    it("requires --title", async () => {
      await expect(issueCommand(["create"], ctx)).rejects.toThrow(AxiError);
    });

    it("returns created issue", async () => {
      mockedGhExec.mockResolvedValue(
        "https://github.com/octo/repo/issues/99\n",
      );
      mockedGhJson.mockResolvedValue({
        number: 99,
        title: "New issue",
        state: "OPEN",
        url: "https://github.com/octo/repo/issues/99",
      });

      const result = await issueCommand(
        ["create", "--title", "New issue"],
        ctx,
      );

      expect(result).toContain("99");
      expect(result).toContain("New issue");
      expect(mockedGhExec).toHaveBeenCalledWith(
        expect.arrayContaining(["issue", "create", "--title", "New issue"]),
        ctx,
      );
    });

    it("applies --type via graphql mutation and renders the type", async () => {
      // 1) resolve type
      mockTypeQueryOnce([
        { id: "T_task", name: "Task" },
        { id: "T_feat", name: "Feature" },
      ]);
      mockedGhExec.mockResolvedValue(
        "https://github.com/octo/repo/issues/99\n",
      );
      mockedGhJson.mockResolvedValue({
        number: 99,
        title: "New",
        state: "OPEN",
        url: "https://github.com/octo/repo/issues/99",
        id: "I_node99",
      });
      // 2) apply mutation
      mockTypeMutationOnce();

      const result = await issueCommand(
        ["create", "--title", "New", "--type", "Task"],
        ctx,
      );

      expect(result).toContain("type: Task");

      // Verify resolve query was issued
      const resolveCall = mockedGhRaw.mock.calls.find((c) =>
        (c[0] as string[]).some(
          (a) => typeof a === "string" && a.includes("issueTypes"),
        ),
      );
      expect(resolveCall).toBeDefined();

      // Verify mutation was issued with issue node ID and type id
      const mutationCall = mockedGhRaw.mock.calls.find((c) =>
        (c[0] as string[]).some(
          (a) => typeof a === "string" && a.includes("updateIssue"),
        ),
      );
      expect(mutationCall).toBeDefined();
      const flat = (mutationCall![0] as string[]).join(" ");
      expect(flat).toContain("I_node99");
      expect(flat).toContain("T_task");
    });

    it("matches --type case-insensitively", async () => {
      mockTypeQueryOnce([{ id: "T_task", name: "Task" }]);
      mockedGhExec.mockResolvedValue(
        "https://github.com/octo/repo/issues/99\n",
      );
      mockedGhJson.mockResolvedValue({
        number: 99,
        title: "New",
        state: "OPEN",
        url: "https://github.com/octo/repo/issues/99",
        id: "I_node99",
      });
      mockTypeMutationOnce();

      const result = await issueCommand(
        ["create", "--title", "New", "--type", "task"],
        ctx,
      );

      expect(result).toContain("type: Task");
    });

    it("rejects unknown --type with a hint listing supported types", async () => {
      mockTypeQueryOnce([
        { id: "T_task", name: "Task" },
        { id: "T_feat", name: "Feature" },
        { id: "T_bug", name: "Bug" },
      ]);

      await expect(
        issueCommand(["create", "--title", "X", "--type", "Bogus"], ctx),
      ).rejects.toThrow(AxiError);

      mockTypeQueryOnce([
        { id: "T_task", name: "Task" },
        { id: "T_feat", name: "Feature" },
        { id: "T_bug", name: "Bug" },
      ]);

      try {
        await issueCommand(["create", "--title", "X", "--type", "Bogus"], ctx);
      } catch (e) {
        expect((e as AxiError).code).toBe("VALIDATION_ERROR");
        expect((e as AxiError).message).toContain("Task");
        expect((e as AxiError).message).toContain("Feature");
        expect((e as AxiError).message).toContain("Bug");
      }
      // No gh issue create should have been called when type resolution fails
      expect(mockedGhExec).not.toHaveBeenCalled();
    });

    it("rejects --type without a value", async () => {
      await expect(
        issueCommand(["create", "--title", "X", "--type"], ctx),
      ).rejects.toThrow(AxiError);
      expect(mockedGhExec).not.toHaveBeenCalled();
    });
  });

  describe("edit with --type", () => {
    it("applies --type via graphql mutation", async () => {
      // 1) resolve type
      mockTypeQueryOnce([
        { id: "T_task", name: "Task" },
        { id: "T_feat", name: "Feature" },
      ]);
      mockedGhJson.mockResolvedValue({
        number: 10,
        title: "X",
        state: "OPEN",
        labels: [],
        assignees: [],
        id: "I_node10",
      });
      // 2) apply mutation
      mockTypeMutationOnce();

      const result = await issueCommand(
        ["edit", "10", "--type", "Feature"],
        ctx,
      );

      expect(result).toContain("type: Feature");
      // No `gh issue edit` should be invoked when only --type is provided
      expect(mockedGhExec).not.toHaveBeenCalled();

      const mutationCall = mockedGhRaw.mock.calls.find((c) =>
        (c[0] as string[]).some(
          (a) => typeof a === "string" && a.includes("updateIssue"),
        ),
      );
      expect(mutationCall).toBeDefined();
      const flat = (mutationCall![0] as string[]).join(" ");
      expect(flat).toContain("I_node10");
      expect(flat).toContain("T_feat");
    });

    it("clears the type when --no-type is passed", async () => {
      mockedGhJson.mockResolvedValue({
        number: 10,
        title: "X",
        state: "OPEN",
        labels: [],
        assignees: [],
        id: "I_node10",
      });
      mockTypeMutationOnce();

      await issueCommand(["edit", "10", "--no-type"], ctx);

      const mutationCall = mockedGhRaw.mock.calls.find((c) =>
        (c[0] as string[]).some(
          (a) => typeof a === "string" && a.includes("updateIssue"),
        ),
      );
      expect(mutationCall).toBeDefined();
      const flat = (mutationCall![0] as string[]).join(" ");
      // null literal embedded directly in the mutation
      expect(flat).toContain("issueTypeId:null");
    });

    it("rejects --type without a value", async () => {
      await expect(issueCommand(["edit", "10", "--type"], ctx)).rejects.toThrow(
        AxiError,
      );
      expect(mockedGhJson).not.toHaveBeenCalled();
      expect(mockedGhExec).not.toHaveBeenCalled();
    });
  });

  describe("close", () => {
    it("returns already closed when issue is already closed (idempotent)", async () => {
      // First call: check current state
      mockedGhJson.mockResolvedValueOnce({ state: "closed" });
      // Second call: fetch for display
      mockedGhJson.mockResolvedValueOnce({ number: 10, state: "closed" });

      const result = await issueCommand(["close", "10"], ctx);

      expect(result).toContain("closed");
      expect(result).toContain("Already closed");
      expect(mockedGhExec).not.toHaveBeenCalled();
    });
  });

  describe("lock", () => {
    it("returns already locked when issue is already locked (idempotent)", async () => {
      mockedGhJson.mockResolvedValue({ locked: true, state: "OPEN" });

      const result = await issueCommand(["lock", "10"], ctx);

      expect(result).toContain("Already locked");
      expect(mockedGhExec).not.toHaveBeenCalled();
    });
  });

  describe("transfer", () => {
    it("requires --to-repo", async () => {
      await expect(issueCommand(["transfer", "10"], ctx)).rejects.toThrow(
        AxiError,
      );
    });

    it("transfers to the destination repo provided by --to-repo", async () => {
      mockedGhExec.mockResolvedValue("");
      mockedGhJson.mockResolvedValue({
        number: 10,
        url: "https://github.com/dest/repo/issues/10",
      });

      const result = await issueCommand(
        ["transfer", "10", "--to-repo", "dest/repo"],
        ctx,
      );

      expect(result).toContain("dest/repo/issues/10");
      expect(mockedGhExec).toHaveBeenCalledWith(
        ["issue", "transfer", "10", "dest/repo"],
        ctx,
      );
      expect(mockedGhJson).toHaveBeenCalledWith([
        "issue",
        "view",
        "10",
        "--json",
        "number,url",
        "--repo",
        "dest/repo",
      ]);
    });
  });
});
