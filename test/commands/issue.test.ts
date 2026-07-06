import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/gh.js", () => ({
  ghJson: vi.fn(),
  ghExec: vi.fn(),
  ghRaw: vi.fn(),
}));

import { ghJson, ghExec, ghRaw } from "../../src/gh.js";
import {
  issueCommand,
  ISSUE_HELP,
  SUBISSUE_HELP,
} from "../../src/commands/issue.js";
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

async function withBodyFile<T>(
  body: string,
  fn: (file: string) => Promise<T>,
): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "gh-axi-issue-body-"));
  try {
    const file = join(dir, "body.md");
    writeFileSync(file, body, "utf8");
    return await fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("issueCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("router", () => {
    it("returns help when --help is passed", async () => {
      const result = await issueCommand(["--help"], ctx);
      expect(result).toContain(ISSUE_HELP);
    });

    it("returns subissue help for subissue --help", async () => {
      const result = await issueCommand(["subissue", "--help"], ctx);
      expect(result).toContain(SUBISSUE_HELP);
      expect(result).not.toContain("usage: gh-axi issue <subcommand>");
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

    it("passes all repeated --label flags to gh issue create (two labels)", async () => {
      mockedGhExec.mockResolvedValue(
        "https://github.com/octo/repo/issues/99\n",
      );
      mockedGhJson.mockResolvedValue({
        number: 99,
        title: "Multi-label issue",
        state: "OPEN",
        url: "https://github.com/octo/repo/issues/99",
      });

      await issueCommand(
        [
          "create",
          "--title",
          "Multi-label issue",
          "--label",
          "enhancement",
          "--label",
          "ready-for-agent",
        ],
        ctx,
      );

      const callArgs = mockedGhExec.mock.calls[0][0] as string[];
      expect(callArgs.filter((a) => a === "--label")).toHaveLength(2);
      expect(callArgs).toContain("enhancement");
      expect(callArgs).toContain("ready-for-agent");
    });

    it("passes all repeated --label flags to gh issue create (three labels)", async () => {
      mockedGhExec.mockResolvedValue(
        "https://github.com/octo/repo/issues/100\n",
      );
      mockedGhJson.mockResolvedValue({
        number: 100,
        title: "Triple-label issue",
        state: "OPEN",
        url: "https://github.com/octo/repo/issues/100",
      });

      await issueCommand(
        [
          "create",
          "--title",
          "Triple-label issue",
          "--label",
          "bug",
          "--label",
          "enhancement",
          "--label",
          "good first issue",
        ],
        ctx,
      );

      const callArgs = mockedGhExec.mock.calls[0][0] as string[];
      expect(callArgs.filter((a) => a === "--label")).toHaveLength(3);
      expect(callArgs).toContain("bug");
      expect(callArgs).toContain("enhancement");
      expect(callArgs).toContain("good first issue");
    });

    it("still passes a single --label flag correctly (no regression)", async () => {
      mockedGhExec.mockResolvedValue(
        "https://github.com/octo/repo/issues/101\n",
      );
      mockedGhJson.mockResolvedValue({
        number: 101,
        title: "Single-label issue",
        state: "OPEN",
        url: "https://github.com/octo/repo/issues/101",
      });

      await issueCommand(
        ["create", "--title", "Single-label issue", "--label", "bug"],
        ctx,
      );

      const callArgs = mockedGhExec.mock.calls[0][0] as string[];
      expect(callArgs.filter((a) => a === "--label")).toHaveLength(1);
      expect(callArgs).toContain("bug");
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

  describe("--body-file", () => {
    const markdownBody = "steps\n```sh\necho ok\n```\nIt's reproducible.";

    it("uses file contents for issue create", async () => {
      await withBodyFile(markdownBody, async (file) => {
        mockedGhExec.mockResolvedValue(
          "https://github.com/octo/repo/issues/99\n",
        );
        mockedGhJson.mockResolvedValue({
          number: 99,
          title: "New issue",
          state: "OPEN",
          url: "https://github.com/octo/repo/issues/99",
        });

        await issueCommand(
          ["create", "--title", "New issue", "--body-file", file],
          ctx,
        );

        expect(mockedGhExec).toHaveBeenCalledWith(
          ["issue", "create", "--title", "New issue", "--body", markdownBody],
          ctx,
        );
      });
    });

    it("uses file contents for issue edit", async () => {
      await withBodyFile(markdownBody, async (file) => {
        mockedGhExec.mockResolvedValue("");
        mockedGhJson.mockResolvedValue({
          number: 99,
          title: "New issue",
          state: "OPEN",
          labels: [],
          assignees: [],
        });

        await issueCommand(["edit", "99", "--body-file", file], ctx);

        expect(mockedGhExec).toHaveBeenCalledWith(
          ["issue", "edit", "99", "--body", markdownBody],
          ctx,
        );
      });
    });

    it("uses file contents for issue comment", async () => {
      await withBodyFile(markdownBody, async (file) => {
        mockedGhExec.mockResolvedValue("");
        mockedGhJson.mockResolvedValue({
          comments: [
            {
              author: { login: "alice" },
              body: markdownBody,
              createdAt: "2026-01-01T00:00:00Z",
            },
          ],
        });

        await issueCommand(["comment", "99", "--body-file", file], ctx);

        expect(mockedGhExec).toHaveBeenCalledWith(
          ["issue", "comment", "99", "--body", markdownBody],
          ctx,
        );
      });
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

    it("builds the fallback URL on the configured host when the follow-up view fails", async () => {
      const originalHost = process.env.GH_HOST;
      process.env.GH_HOST = "git.example.com";
      try {
        mockedGhExec.mockResolvedValue("");
        mockedGhJson.mockRejectedValue(new AxiError("nope", "NOT_FOUND"));

        const result = await issueCommand(
          ["transfer", "10", "--to-repo", "dest/repo"],
          ctx,
        );

        expect(result).toContain("https://git.example.com/dest/repo/issues/10");
      } finally {
        if (originalHost === undefined) {
          delete process.env.GH_HOST;
        } else {
          process.env.GH_HOST = originalHost;
        }
      }
    });

    it("builds the fallback URL on github.com by default", async () => {
      const originalHost = process.env.GH_HOST;
      delete process.env.GH_HOST;
      try {
        mockedGhExec.mockResolvedValue("");
        mockedGhJson.mockRejectedValue(new AxiError("nope", "NOT_FOUND"));

        const result = await issueCommand(
          ["transfer", "10", "--to-repo", "dest/repo"],
          ctx,
        );

        expect(result).toContain("https://github.com/dest/repo/issues/10");
      } finally {
        if (originalHost === undefined) {
          delete process.env.GH_HOST;
        } else {
          process.env.GH_HOST = originalHost;
        }
      }
    });
  });

  describe("view with sub-issue relationships", () => {
    it("includes parent and subissues when the GraphQL augmentation returns data", async () => {
      mockedGhJson.mockImplementation(async (args: string[]) => {
        if (args[0] === "issue" && args[1] === "view") {
          return {
            number: 42,
            title: "Parent issue",
            state: "OPEN",
            author: { login: "alice" },
            createdAt: "2024-01-01T00:00:00Z",
            body: "body",
          };
        }
        if (args[0] === "api" && args[1] === "graphql") {
          return {
            data: {
              repository: {
                issue: {
                  parent: { number: 16 },
                  subIssues: {
                    totalCount: 3,
                    nodes: [{ number: 20 }, { number: 101 }, { number: 125 }],
                  },
                },
              },
            },
          };
        }
        throw new Error(`Unexpected ghJson call: ${args.join(" ")}`);
      });

      const result = await issueCommand(["view", "42"], ctx);

      expect(result).toContain("subissues[3]: #20,#101,#125");
      expect(result).toContain("parent: #16");
    });

    it("omits parent and subissues fields when neither is present", async () => {
      mockedGhJson.mockImplementation(async (args: string[]) => {
        if (args[0] === "issue" && args[1] === "view") {
          return {
            number: 42,
            title: "Standalone",
            state: "OPEN",
            author: { login: "alice" },
            createdAt: "2024-01-01T00:00:00Z",
            body: "body",
          };
        }
        if (args[0] === "api" && args[1] === "graphql") {
          return {
            data: {
              repository: {
                issue: {
                  parent: null,
                  subIssues: { totalCount: 0, nodes: [] },
                },
              },
            },
          };
        }
        throw new Error(`Unexpected ghJson call: ${args.join(" ")}`);
      });

      const result = await issueCommand(["view", "42"], ctx);

      expect(result).not.toContain("subissues");
      expect(result).not.toMatch(/^parent:/m);
    });

    it("still renders the issue when the sub-issue GraphQL call fails", async () => {
      mockedGhJson.mockImplementation(async (args: string[]) => {
        if (args[0] === "issue" && args[1] === "view") {
          return {
            number: 42,
            title: "Critical bug",
            state: "OPEN",
            author: { login: "alice" },
            createdAt: "2024-01-01T00:00:00Z",
            body: "body",
          };
        }
        if (args[0] === "api" && args[1] === "graphql") {
          throw new AxiError("graphql failed", "UNKNOWN");
        }
        throw new Error(`Unexpected ghJson call: ${args.join(" ")}`);
      });

      const result = await issueCommand(["view", "42"], ctx);

      expect(result).toContain("Critical bug");
      expect(result).not.toContain("subissues");
    });
  });

  describe("subissue", () => {
    function graphqlQueryArg(args: string[]): string {
      const fIdx = args.indexOf("-f");
      if (fIdx === -1) return "";
      const val = args[fIdx + 1] ?? "";
      return val.replace(/^query=/, "");
    }

    it("rejects unknown subissue subcommand", async () => {
      const result = await issueCommand(["subissue", "frobnicate"], ctx);
      expect(result).toContain("Unknown");
    });

    it("returns help when no subissue subcommand given", async () => {
      const result = await issueCommand(["subissue"], ctx);
      expect(result).toContain("subissue");
      expect(result).toContain("add");
      expect(result).toContain("remove");
      expect(result).toContain("list");
    });

    describe("add", () => {
      it("issues one addSubIssue mutation per child", async () => {
        const ghJsonCalls: string[][] = [];
        mockedGhJson.mockImplementation(async (args: string[]) => {
          ghJsonCalls.push(args);
          const query = graphqlQueryArg(args);
          if (query.includes("query") && !query.includes("mutation")) {
            // resolution query
            return {
              data: {
                repository: {
                  parent: { id: "P_1", number: 1 },
                  c0: { id: "C_2", number: 2 },
                  c1: { id: "C_3", number: 3 },
                  c2: { id: "C_4", number: 4 },
                },
              },
            };
          }
          // mutation
          const subIssueNumber = query.includes("C_2")
            ? 2
            : query.includes("C_3")
              ? 3
              : 4;
          return {
            data: {
              addSubIssue: { subIssue: { number: subIssueNumber } },
            },
          };
        });

        const result = await issueCommand(
          ["subissue", "add", "1", "2", "3", "4"],
          ctx,
        );

        // Four GraphQL calls total: one resolution query, one mutation per child.
        const graphqlCalls = ghJsonCalls.filter(
          (c) => c[0] === "api" && c[1] === "graphql",
        );
        expect(graphqlCalls).toHaveLength(4);

        const mutationQueries = graphqlCalls
          .map(graphqlQueryArg)
          .filter((q) => q.includes("mutation"));
        expect(mutationQueries).toHaveLength(3);
        expect(mutationQueries[0]).toContain('subIssueId: "C_2"');
        expect(mutationQueries[1]).toContain('subIssueId: "C_3"');
        expect(mutationQueries[2]).toContain('subIssueId: "C_4"');
        for (const mutationQuery of mutationQueries) {
          expect(mutationQuery.match(/addSubIssue/g)?.length).toBe(1);
        }

        expect(result).toContain("parent: #1");
        expect(result).toContain("#2");
        expect(result).toContain("#3");
        expect(result).toContain("#4");
      });

      it("requires at least one child", async () => {
        await expect(
          issueCommand(["subissue", "add", "1"], ctx),
        ).rejects.toThrow(AxiError);
      });

      it("requires a parent argument", async () => {
        await expect(issueCommand(["subissue", "add"], ctx)).rejects.toThrow(
          AxiError,
        );
      });

      it("reports already added children when a later add fails", async () => {
        mockedGhJson.mockImplementation(async (args: string[]) => {
          const query = graphqlQueryArg(args);
          if (query.includes("query") && !query.includes("mutation")) {
            return {
              data: {
                repository: {
                  parent: { id: "P_1", number: 1 },
                  c0: { id: "C_2", number: 2 },
                  c1: { id: "C_3", number: 3 },
                },
              },
            };
          }
          if (query.includes('subIssueId: "C_2"')) {
            return {
              data: { addSubIssue: { subIssue: { number: 2 } } },
            };
          }
          throw new AxiError("GraphQL add failed", "UNKNOWN");
        });

        await expect(
          issueCommand(["subissue", "add", "1", "2", "3"], ctx),
        ).rejects.toThrow(/Added before failure: #2/);
      });
    });

    describe("remove", () => {
      it("sends a single removeSubIssue mutation", async () => {
        const ghJsonCalls: string[][] = [];
        mockedGhJson.mockImplementation(async (args: string[]) => {
          ghJsonCalls.push(args);
          const query = graphqlQueryArg(args);
          if (query.includes("query") && !query.includes("mutation")) {
            return {
              data: {
                repository: {
                  parent: { id: "P_1", number: 1 },
                  c0: { id: "C_2", number: 2 },
                },
              },
            };
          }
          return { data: { removeSubIssue: { issue: { number: 1 } } } };
        });

        const result = await issueCommand(
          ["subissue", "remove", "1", "2"],
          ctx,
        );

        const graphqlCalls = ghJsonCalls.filter(
          (c) => c[0] === "api" && c[1] === "graphql",
        );
        const mutationCall = graphqlCalls.find((c) =>
          graphqlQueryArg(c).includes("mutation"),
        );
        expect(mutationCall).toBeDefined();
        expect(graphqlQueryArg(mutationCall!)).toContain("removeSubIssue");

        expect(result).toContain("parent: #1");
        expect(result).toContain("removed: #2");
      });

      it("requires both parent and child", async () => {
        await expect(
          issueCommand(["subissue", "remove", "1"], ctx),
        ).rejects.toThrow(AxiError);
      });
    });

    describe("list", () => {
      it("lists sub-issues of a parent", async () => {
        mockedGhJson.mockResolvedValue({
          data: {
            repository: {
              issue: {
                subIssues: {
                  totalCount: 2,
                  nodes: [
                    { number: 20, title: "Foo", state: "OPEN" },
                    { number: 101, title: "Bar", state: "CLOSED" },
                  ],
                },
              },
            },
          },
        });

        const result = await issueCommand(["subissue", "list", "1"], ctx);

        expect(result).toContain("parent: #1");
        expect(result).toContain("count: 2");
        expect(result).toContain("Foo");
        expect(result).toContain("Bar");
        expect(result).toContain("open");
        expect(result).toContain("closed");
      });

      it("renders count: 0 when there are no sub-issues", async () => {
        mockedGhJson.mockResolvedValue({
          data: {
            repository: {
              issue: { subIssues: { totalCount: 0, nodes: [] } },
            },
          },
        });

        const result = await issueCommand(["subissue", "list", "1"], ctx);
        expect(result).toContain("count: 0");
      });

      it("requires a parent argument", async () => {
        await expect(issueCommand(["subissue", "list"], ctx)).rejects.toThrow(
          AxiError,
        );
      });
    });
  });
});
