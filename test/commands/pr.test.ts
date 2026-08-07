import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/gh.js", () => ({
  ghJson: vi.fn(),
  ghExec: vi.fn(),
  ghRaw: vi.fn(),
}));

vi.mock("../../src/worktree.js", () => ({
  baseBranchNeedsExplicitRepo: vi.fn(),
}));

import { ghJson, ghExec, ghRaw } from "../../src/gh.js";
import { prCommand, PR_HELP } from "../../src/commands/pr.js";
import { AxiError } from "../../src/errors.js";
import { baseBranchNeedsExplicitRepo } from "../../src/worktree.js";
import type { RepoContext } from "../../src/context.js";

const mockedGhJson = vi.mocked(ghJson);
const mockedGhExec = vi.mocked(ghExec);
const mockedGhRaw = vi.mocked(ghRaw);
const mockedBaseBranchNeedsExplicitRepo = vi.mocked(
  baseBranchNeedsExplicitRepo,
);

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
  const dir = mkdtempSync(join(tmpdir(), "gh-axi-pr-body-"));
  try {
    const file = join(dir, "body.md");
    writeFileSync(file, body, "utf8");
    return await fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("prCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedBaseBranchNeedsExplicitRepo.mockReturnValue(false);
  });

  describe("router", () => {
    it("returns help when --help is passed", async () => {
      const result = await prCommand(["--help"]);
      expect(result).toBe(PR_HELP);
    });

    it("returns help when no subcommand is given", async () => {
      const result = await prCommand([]);
      expect(result).toBe(PR_HELP);
    });

    it("returns error for unknown subcommand", async () => {
      const result = await prCommand(["unknown"]);
      expect(result).toContain("Unknown pr subcommand: unknown");
    });
  });

  describe("list filtered totals", () => {
    const twoPrs = [
      { number: 1, title: "A", state: "OPEN", isDraft: false },
      { number: 2, title: "B", state: "OPEN", isDraft: true },
    ];

    it("counts only filtered PRs when --label is applied", async () => {
      mockedGhJson.mockResolvedValue(twoPrs);
      mockedGhRaw.mockResolvedValue({
        stdout: JSON.stringify({ data: { search: { issueCount: 12 } } }),
        stderr: "",
        exitCode: 0,
      });

      const result = await prCommand(
        ["list", "--limit", "2", "--label", "bug"],
        ctx,
      );

      const gqlArgs = mockedGhRaw.mock.calls[0][0] as string[];
      const searchQuery = gqlArgs.find((a) => a.startsWith("q="));
      expect(searchQuery).toContain("repo:octo/repo");
      expect(searchQuery).toContain("is:pr");
      expect(searchQuery).toContain("is:open");
      expect(searchQuery).toContain("label:bug");
      expect(result).toContain("count: 2 of 12 total");
    });

    it("carries assignee, author, base, head and draft into the total", async () => {
      mockedGhJson.mockResolvedValue(twoPrs);
      mockedGhRaw.mockResolvedValue({
        stdout: JSON.stringify({ data: { search: { issueCount: 4 } } }),
        stderr: "",
        exitCode: 0,
      });

      await prCommand(
        [
          "list",
          "--limit",
          "2",
          "--assignee",
          "octocat",
          "--author",
          "hubot",
          "--base",
          "main",
          "--head",
          "feature",
          "--draft",
        ],
        ctx,
      );

      const gqlArgs = mockedGhRaw.mock.calls[0][0] as string[];
      const searchQuery = gqlArgs.find((a) => a.startsWith("q="));
      expect(searchQuery).toContain("assignee:octocat");
      expect(searchQuery).toContain("author:hubot");
      expect(searchQuery).toContain("base:main");
      expect(searchQuery).toContain("head:feature");
      expect(searchQuery).toContain("draft:true");
    });

    it("uses the exact repository total when no filter is applied", async () => {
      mockedGhJson.mockResolvedValue(twoPrs);
      mockedGhRaw.mockResolvedValue({
        stdout: JSON.stringify({
          data: { repository: { pullRequests: { totalCount: 310 } } },
        }),
        stderr: "",
        exitCode: 0,
      });

      const result = await prCommand(["list", "--limit", "2"], ctx);

      const query = (mockedGhRaw.mock.calls[0][0] as string[]).join(" ");
      expect(query).toContain("repository(");
      expect(query).toContain("pullRequests(states:[OPEN])");
      expect(query).not.toContain("search(");
      expect(result).toContain("count: 2 of 310 total");
    });

    it("counts merged PRs alongside closed ones in the repository total", async () => {
      mockedGhJson.mockResolvedValue(twoPrs);
      mockedGhRaw.mockResolvedValue({
        stdout: JSON.stringify({
          data: { repository: { pullRequests: { totalCount: 88 } } },
        }),
        stderr: "",
        exitCode: 0,
      });

      await prCommand(["list", "--limit", "2", "--state", "closed"], ctx);

      const query = (mockedGhRaw.mock.calls[0][0] as string[]).join(" ");
      expect(query).toContain("pullRequests(states:[CLOSED,MERGED])");
    });

    it("omits the states argument for an unfiltered --state all total", async () => {
      mockedGhJson.mockResolvedValue(twoPrs);
      mockedGhRaw.mockResolvedValue({
        stdout: JSON.stringify({
          data: { repository: { pullRequests: { totalCount: 500 } } },
        }),
        stderr: "",
        exitCode: 0,
      });

      const result = await prCommand(
        ["list", "--limit", "2", "--state", "all"],
        ctx,
      );

      const query = (mockedGhRaw.mock.calls[0][0] as string[]).join(" ");
      expect(query).toContain("pullRequests { totalCount }");
      expect(query).not.toContain("states:");
      expect(result).toContain("count: 2 of 500 total");
    });

    it("counts every label of a comma-separated --label list", async () => {
      mockedGhJson.mockResolvedValue(twoPrs);
      mockedGhRaw.mockResolvedValue({
        stdout: JSON.stringify({ data: { search: { issueCount: 6 } } }),
        stderr: "",
        exitCode: 0,
      });

      await prCommand(["list", "--limit", "2", "--label", "bug,docs"], ctx);

      const gqlArgs = mockedGhRaw.mock.calls[0][0] as string[];
      const searchQuery = gqlArgs.find((a) => a.startsWith("q="));
      expect(searchQuery).toContain("label:bug");
      expect(searchQuery).toContain("label:docs");
      expect(searchQuery).not.toContain("label:bug,docs");
    });

    it("omits the total rather than guessing when the count lookup fails", async () => {
      mockedGhJson.mockResolvedValue(twoPrs);
      mockedGhRaw.mockResolvedValue({
        stdout: "",
        stderr: "boom",
        exitCode: 1,
      });

      const result = await prCommand(
        ["list", "--limit", "2", "--label", "bug"],
        ctx,
      );

      expect(result).toContain("count: 2 (showing first 2)");
      expect(result).not.toContain("total");
    });
  });

  describe("list", () => {
    it("returns list with count line", async () => {
      mockedGhJson.mockResolvedValue([
        {
          number: 1,
          title: "Fix bug",
          state: "OPEN",
          author: { login: "alice" },
          isDraft: false,
          reviewDecision: "APPROVED",
        },
        {
          number: 2,
          title: "Add feature",
          state: "OPEN",
          author: { login: "bob" },
          isDraft: true,
          reviewDecision: "",
        },
      ]);

      const result = await prCommand(["list"], ctx);

      expect(result).toContain("count: 2");
      expect(result).toContain("Fix bug");
      expect(result).toContain("Add feature");
      expect(mockedGhJson).toHaveBeenCalledWith(
        expect.arrayContaining(["pr", "list", "--json"]),
        ctx,
      );
    });

    it("uses default compact --json fields when --fields is not passed", async () => {
      mockedGhJson.mockResolvedValue([]);
      await prCommand(["list"], ctx);

      const callArgs = mockedGhJson.mock.calls[0][0] as string[];
      const jsonIdx = callArgs.indexOf("--json");
      const jsonValue = callArgs[jsonIdx + 1];
      expect(jsonValue).not.toContain("body");
      expect(jsonValue).not.toContain("createdAt");
      expect(jsonValue).toContain("number");
      expect(jsonValue).toContain("title");
    });

    it("extends --json and schema when --fields is passed", async () => {
      mockedGhJson.mockResolvedValue([
        {
          number: 1,
          title: "Fix",
          state: "OPEN",
          author: { login: "alice" },
          isDraft: false,
          reviewDecision: "APPROVED",
          body: "PR body text",
          createdAt: "2024-01-01T00:00:00Z",
        },
      ]);

      const result = await prCommand(
        ["list", "--fields", "body,createdAt"],
        ctx,
      );

      const callArgs = mockedGhJson.mock.calls[0][0] as string[];
      const jsonIdx = callArgs.indexOf("--json");
      const jsonValue = callArgs[jsonIdx + 1];
      expect(jsonValue).toContain("body");
      expect(jsonValue).toContain("createdAt");

      expect(result).toContain("PR body text");
    });

    it("throws VALIDATION_ERROR for unknown --fields", async () => {
      await expect(
        prCommand(["list", "--fields", "fakeField"], ctx),
      ).rejects.toThrow(AxiError);

      try {
        await prCommand(["list", "--fields", "fakeField"], ctx);
      } catch (e) {
        expect((e as AxiError).code).toBe("VALIDATION_ERROR");
        expect((e as AxiError).message).toContain("fakeField");
      }
    });
  });

  describe("view", () => {
    it("returns detail with schema fields", async () => {
      mockedGhJson.mockResolvedValue({
        number: 42,
        title: "My PR",
        state: "OPEN",
        author: { login: "alice" },
        isDraft: false,
        mergedAt: null,
        statusCheckRollup: [],
        body: "PR description here",
        comments: [],
      });

      const result = await prCommand(["view", "42"], ctx);

      expect(result).toContain("42");
      expect(result).toContain("My PR");
      expect(result).toContain("open");
      expect(result).toContain("alice");
    });

    it("omits help suggestions from detail view", async () => {
      mockedGhJson.mockResolvedValue({
        number: 42,
        title: "My PR",
        state: "OPEN",
        author: { login: "alice" },
        isDraft: false,
        mergedAt: null,
        statusCheckRollup: [],
        body: "desc",
        comments: [],
      });
      const result = await prCommand(["view", "42"], ctx);
      expect(result).not.toMatch(/^help\[/m);
    });

    it("shows review_count summary when --reviews is not passed", async () => {
      mockedGhJson.mockResolvedValue({
        number: 42,
        title: "My PR",
        state: "OPEN",
        author: { login: "alice" },
        isDraft: false,
        mergedAt: null,
        statusCheckRollup: [],
        body: "desc",
        comments: [],
        reviews: [{ id: "PRR_1" }, { id: "PRR_2" }],
      });

      const result = await prCommand(["view", "42"], ctx);

      expect(result).toContain("review_count: 2");
      expect(result).toContain("use --reviews to see full reviews");
    });

    it("lists review submissions and inline comments with --reviews", async () => {
      mockedGhJson
        .mockResolvedValueOnce({
          number: 42,
          title: "My PR",
          state: "OPEN",
          author: { login: "alice" },
          isDraft: false,
          mergedAt: null,
          statusCheckRollup: [],
          body: "desc",
          comments: [],
          reviews: [{ id: "PRR_1" }],
        })
        .mockResolvedValueOnce([
          {
            id: 1001,
            user: { login: "cursor[bot]" },
            body: "Found 2 issues",
            state: "COMMENTED",
            submitted_at: "2026-04-01T00:00:00Z",
          },
          {
            id: 1002,
            user: { login: "reviewer" },
            body: "",
            state: "APPROVED",
            submitted_at: "2026-04-02T00:00:00Z",
          },
        ])
        .mockResolvedValueOnce([
          {
            pull_request_review_id: 1001,
            user: { login: "cursor[bot]" },
            path: "src/foo.ts",
            line: 42,
            body: "This could be null",
            created_at: "2026-04-01T00:00:00Z",
          },
          {
            pull_request_review_id: 1001,
            user: { login: "cursor[bot]" },
            path: "src/bar.ts",
            line: null,
            original_line: 7,
            body: "Off-by-one bug",
            created_at: "2026-04-01T00:00:00Z",
          },
        ]);

      const result = await prCommand(["view", "42", "--reviews"], ctx);

      // Review submissions surfaced
      expect(result).toContain("cursor[bot]");
      expect(result).toContain("commented");
      expect(result).toContain("Found 2 issues");
      expect(result).toContain("approved");
      // Inline comments surfaced under the right review
      expect(result).toContain("src/foo.ts");
      expect(result).toContain("This could be null");
      expect(result).toContain("src/bar.ts");
      expect(result).toContain("Off-by-one bug");
      // review_count is replaced by full reviews block
      expect(result).not.toContain("use --reviews to see full reviews");

      // Verify REST endpoints were used
      const apiCalls = mockedGhJson.mock.calls.map((c) => c[0]);
      expect(
        apiCalls.some(
          (a) =>
            Array.isArray(a) &&
            a.includes("api") &&
            (a as string[]).some((s) => s.includes("/pulls/42/reviews")),
        ),
      ).toBe(true);
      expect(
        apiCalls.some(
          (a) =>
            Array.isArray(a) &&
            a.includes("api") &&
            (a as string[]).some((s) => s.includes("/pulls/42/comments")),
        ),
      ).toBe(true);
    });

    it("uses explicit REST paths without repo context for review fetches", async () => {
      mockedGhJson
        .mockResolvedValueOnce({
          number: 42,
          title: "My PR",
          state: "OPEN",
          author: { login: "alice" },
          isDraft: false,
          mergedAt: null,
          statusCheckRollup: [],
          body: "desc",
          comments: [],
          reviews: [],
        })
        .mockResolvedValueOnce([]);

      await prCommand(["view", "42", "--reviews"], ctx);

      expect(mockedGhJson).toHaveBeenNthCalledWith(2, [
        "api",
        "repos/octo/repo/pulls/42/reviews",
        "--paginate",
        "--slurp",
      ]);
    });

    it("flattens paginated review and inline comment pages", async () => {
      mockedGhJson
        .mockResolvedValueOnce({
          number: 42,
          title: "My PR",
          state: "OPEN",
          author: { login: "alice" },
          isDraft: false,
          mergedAt: null,
          statusCheckRollup: [],
          body: "desc",
          comments: [],
          reviews: [{ id: "PRR_1" }],
        })
        .mockResolvedValueOnce([
          [
            {
              id: 3001,
              user: { login: "erin" },
              body: "page one review",
              state: "COMMENTED",
              submitted_at: "2026-04-04T00:00:00Z",
            },
          ],
          [
            {
              id: 3002,
              user: { login: "frank" },
              body: "page two review",
              state: "APPROVED",
              submitted_at: "2026-04-05T00:00:00Z",
            },
          ],
        ])
        .mockResolvedValueOnce([
          [
            {
              pull_request_review_id: 3001,
              user: { login: "erin" },
              path: "src/a.ts",
              line: 10,
              body: "page one comment",
              created_at: "2026-04-04T00:00:00Z",
            },
          ],
          [
            {
              pull_request_review_id: 3002,
              user: { login: "frank" },
              path: "src/b.ts",
              line: 20,
              body: "page two comment",
              created_at: "2026-04-05T00:00:00Z",
            },
          ],
        ]);

      const result = await prCommand(["view", "42", "--reviews"], ctx);

      expect(result).toContain("page one review");
      expect(result).toContain("page two review");
      expect(result).toContain("page one comment");
      expect(result).toContain("page two comment");
    });

    it("skips inline-comment fetch when there are no reviews", async () => {
      mockedGhJson
        .mockResolvedValueOnce({
          number: 42,
          title: "My PR",
          state: "OPEN",
          author: { login: "alice" },
          isDraft: false,
          mergedAt: null,
          statusCheckRollup: [],
          body: "desc",
          comments: [],
          reviews: [],
        })
        .mockResolvedValueOnce([]); // empty reviews from REST

      const result = await prCommand(["view", "42", "--reviews"], ctx);

      // Two calls only: pr view --json and pulls/42/reviews. No comments call.
      expect(mockedGhJson).toHaveBeenCalledTimes(2);
      expect(result).toContain("reviews");
    });

    it("renders both comments and reviews when --comments --reviews are combined", async () => {
      mockedGhJson
        .mockResolvedValueOnce({
          number: 42,
          title: "My PR",
          state: "OPEN",
          author: { login: "alice" },
          isDraft: false,
          mergedAt: null,
          statusCheckRollup: [],
          body: "desc",
          comments: [
            {
              author: { login: "carol" },
              body: "top-level chat",
              createdAt: "2026-04-01T00:00:00Z",
            },
          ],
          reviews: [{ id: "PRR_1" }],
        })
        .mockResolvedValueOnce([
          {
            id: 2001,
            user: { login: "dave" },
            body: "lgtm with nits",
            state: "CHANGES_REQUESTED",
            submitted_at: "2026-04-03T00:00:00Z",
          },
        ])
        .mockResolvedValueOnce([
          {
            pull_request_review_id: 2001,
            user: { login: "dave" },
            path: "README.md",
            line: 1,
            body: "fix typo",
            created_at: "2026-04-03T00:00:00Z",
          },
        ]);

      const result = await prCommand(
        ["view", "42", "--comments", "--reviews"],
        ctx,
      );

      expect(result).toContain("top-level chat");
      expect(result).toContain("carol");
      expect(result).toContain("lgtm with nits");
      expect(result).toContain("changes_requested");
      expect(result).toContain("fix typo");
      expect(result).not.toContain("use --comments to see full comments");
      expect(result).not.toContain("use --reviews to see full reviews");
    });
  });

  describe("list and create with repeatable flags", () => {
    it("passes all repeated --label filters to gh pr list", async () => {
      mockedGhJson.mockResolvedValue([]);

      await prCommand(["list", "--label", "bug", "--label", "chore"], ctx);

      expect(mockedGhJson.mock.calls[0][0]).toEqual([
        "pr",
        "list",
        "--json",
        "number,title,state,author,isDraft,reviewDecision",
        "--state",
        "open",
        "--limit",
        "30",
        "--label",
        "bug",
        "--label",
        "chore",
      ]);
    });

    it("passes all repeated --project flags to gh pr create", async () => {
      mockedGhExec.mockResolvedValue("https://github.com/octo/repo/pull/7\n");

      await prCommand(
        ["create", "--title", "T", "--project", "Roadmap", "--project", "Q3"],
        ctx,
      );

      expect(mockedGhExec.mock.calls[0][0]).toEqual([
        "pr",
        "create",
        "--title",
        "T",
        "--project",
        "Roadmap",
        "--project",
        "Q3",
      ]);
    });

    it("rejects an empty --label value instead of dropping it", async () => {
      await expect(prCommand(["list", "--label="], ctx)).rejects.toThrow(
        "--label requires a value",
      );
      expect(mockedGhJson).not.toHaveBeenCalled();
    });

    it("accepts default identity fields alongside optional list fields", async () => {
      mockedGhJson.mockResolvedValue([]);

      await prCommand(
        ["list", "--fields", "number,title,state,author,createdAt,url"],
        ctx,
      );

      expect(mockedGhJson.mock.calls[0][0]).toEqual([
        "pr",
        "list",
        "--json",
        "number,title,state,author,isDraft,reviewDecision,createdAt,url",
        "--state",
        "open",
        "--limit",
        "30",
      ]);
    });
  });

  describe("edit with repeatable flags", () => {
    it("passes all repeated --add-label flags to gh pr edit", async () => {
      mockedGhExec.mockResolvedValue("");

      await prCommand(
        ["edit", "42", "--add-label", "bug", "--add-label", "ready-for-agent"],
        ctx,
      );

      expect(mockedGhExec.mock.calls[0][0]).toEqual([
        "pr",
        "edit",
        "42",
        "--add-label",
        "bug",
        "--add-label",
        "ready-for-agent",
      ]);
    });

    it("passes all repeated --remove-label flags to gh pr edit", async () => {
      mockedGhExec.mockResolvedValue("");

      await prCommand(
        [
          "edit",
          "42",
          "--remove-label",
          "needs-triage",
          "--remove-label",
          "needs-info",
        ],
        ctx,
      );

      expect(mockedGhExec.mock.calls[0][0]).toEqual([
        "pr",
        "edit",
        "42",
        "--remove-label",
        "needs-triage",
        "--remove-label",
        "needs-info",
      ]);
    });

    it("passes all repeated assignee and reviewer flags to gh pr edit", async () => {
      mockedGhExec.mockResolvedValue("");

      await prCommand(
        [
          "edit",
          "42",
          "--add-assignee",
          "octocat",
          "--add-assignee",
          "hubot",
          "--remove-assignee",
          "monalisa",
          "--remove-assignee",
          "ghost",
          "--add-reviewer",
          "alice",
          "--add-reviewer",
          "bob",
          "--remove-reviewer",
          "carol",
          "--remove-reviewer",
          "dave",
        ],
        ctx,
      );

      expect(mockedGhExec.mock.calls[0][0]).toEqual([
        "pr",
        "edit",
        "42",
        "--add-assignee",
        "octocat",
        "--add-assignee",
        "hubot",
        "--remove-assignee",
        "monalisa",
        "--remove-assignee",
        "ghost",
        "--add-reviewer",
        "alice",
        "--add-reviewer",
        "bob",
        "--remove-reviewer",
        "carol",
        "--remove-reviewer",
        "dave",
      ]);
    });

    it("still passes a single --add-label correctly (no regression)", async () => {
      mockedGhExec.mockResolvedValue("");

      await prCommand(["edit", "42", "--add-label", "bug"], ctx);

      expect(mockedGhExec.mock.calls[0][0]).toEqual([
        "pr",
        "edit",
        "42",
        "--add-label",
        "bug",
      ]);
    });
  });

  describe("create with repeatable flags", () => {
    it("passes all repeated --assignee and --reviewer flags to gh pr create", async () => {
      mockedGhExec.mockResolvedValue("https://github.com/o/r/pull/42\n");

      await prCommand(
        [
          "create",
          "--title",
          "T",
          "--assignee",
          "octocat",
          "--assignee",
          "hubot",
          "--reviewer",
          "alice",
          "--reviewer",
          "bob",
        ],
        ctx,
      );

      expect(mockedGhExec.mock.calls[0][0]).toEqual([
        "pr",
        "create",
        "--title",
        "T",
        "--assignee",
        "octocat",
        "--assignee",
        "hubot",
        "--reviewer",
        "alice",
        "--reviewer",
        "bob",
      ]);
    });
  });

  describe("close", () => {
    it("returns already closed when PR is already closed (idempotent)", async () => {
      mockedGhJson.mockResolvedValue({ state: "CLOSED" });

      const result = await prCommand(["close", "10"], ctx);

      expect(result).toContain("closed");
      expect(result).toContain("already");
      expect(mockedGhExec).not.toHaveBeenCalled();
    });
  });

  describe("merge", () => {
    it("returns already merged when PR is already merged (idempotent)", async () => {
      mockedGhJson.mockResolvedValue({
        state: "MERGED",
        mergedBy: { login: "alice" },
        mergedAt: "2024-01-01T00:00:00Z",
        baseRefName: "main",
        url: "https://github.com/octo/repo/pull/10",
      });

      const result = await prCommand(["merge", "10"], ctx);

      expect(result).toContain("merged");
      expect(result).toContain("alice");
      expect(mockedGhExec).not.toHaveBeenCalled();
    });

    it.each([
      ["--squash", "--squash", "squash"],
      ["--merge", "--merge", "merge"],
      ["--rebase", "--rebase", "rebase"],
    ])(
      "maps %s shorthand to a gh merge method flag",
      async (input, ghFlag, method) => {
        mockedGhJson.mockResolvedValue({
          state: "OPEN",
          baseRefName: "main",
          url: "https://github.com/octo/repo/pull/10",
        });
        mockedGhExec.mockResolvedValue("");

        const result = await prCommand(
          ["merge", "10", input, "--delete-branch"],
          ctx,
        );

        expect(mockedGhExec).toHaveBeenCalledWith(
          ["pr", "merge", "10", ghFlag, "--delete-branch"],
          ctx,
        );
        expect(result).toContain(`method: ${method}`);
      },
    );

    it("keeps --method working", async () => {
      mockedGhJson.mockResolvedValue({ state: "OPEN" });
      mockedGhExec.mockResolvedValue("");

      await prCommand(["merge", "10", "--method", "squash"], ctx);

      expect(mockedGhExec).toHaveBeenCalledWith(
        ["pr", "merge", "10", "--squash"],
        ctx,
      );
    });

    it("uses explicit repository mode when another worktree owns the base", async () => {
      mockedGhJson.mockResolvedValue({
        state: "OPEN",
        baseRefName: "main",
        url: "https://github.com/upstream/project/pull/10",
      });
      mockedBaseBranchNeedsExplicitRepo.mockReturnValue(true);
      const gitCtx: RepoContext = { ...ctx, source: "git" };

      await prCommand(["merge", "10", "--delete-branch"], gitCtx);

      expect(mockedGhExec).toHaveBeenCalledWith(
        ["pr", "merge", "10", "--delete-branch"],
        {
          owner: "upstream",
          name: "project",
          nwo: "upstream/project",
          source: "flag",
        },
      );
    });

    it("keeps local branch cleanup in a single worktree", async () => {
      mockedGhJson.mockResolvedValue({
        state: "OPEN",
        baseRefName: "main",
        url: "https://github.com/octo/repo/pull/10",
      });
      const gitCtx: RepoContext = { ...ctx, source: "git" };

      await prCommand(["merge", "10", "--delete-branch"], gitCtx);

      expect(mockedGhExec).toHaveBeenCalledWith(
        ["pr", "merge", "10", "--delete-branch"],
        gitCtx,
      );
    });

    it("fails safely when a conflicting worktree has no valid PR URL", async () => {
      mockedGhJson.mockResolvedValue({
        state: "OPEN",
        baseRefName: "main",
        url: "not-a-pull-request-url",
      });
      mockedBaseBranchNeedsExplicitRepo.mockReturnValue(true);

      await expect(
        prCommand(["merge", "10", "--delete-branch"]),
      ).rejects.toThrow("determine repository from pull request URL");
      expect(mockedGhExec).not.toHaveBeenCalled();
    });
  });

  describe("--body-file", () => {
    const markdownBody = "summary\n```ts\nconst quoted = true;\n```\nIt's ok.";

    it("uses file contents for pr create", async () => {
      await withBodyFile(markdownBody, async (file) => {
        mockedGhExec.mockResolvedValue(
          "https://github.com/octo/repo/pull/123\n",
        );

        await prCommand(
          ["create", "--title", "New PR", "--body-file", file],
          ctx,
        );

        expect(mockedGhExec).toHaveBeenCalledWith(
          ["pr", "create", "--title", "New PR", "--body", markdownBody],
          ctx,
        );
      });
    });

    it("uses file contents for pr edit", async () => {
      await withBodyFile(markdownBody, async (file) => {
        mockedGhExec.mockResolvedValue("");

        await prCommand(["edit", "123", "--body-file", file], ctx);

        expect(mockedGhExec).toHaveBeenCalledWith(
          ["pr", "edit", "123", "--body", markdownBody],
          ctx,
        );
      });
    });

    it("uses file contents for pr merge", async () => {
      await withBodyFile(markdownBody, async (file) => {
        mockedGhJson.mockResolvedValue({ state: "OPEN" });
        mockedGhExec.mockResolvedValue("");

        await prCommand(["merge", "123", "--squash", "--body-file", file], ctx);

        expect(mockedGhExec).toHaveBeenCalledWith(
          ["pr", "merge", "123", "--squash", "--body", markdownBody],
          ctx,
        );
      });
    });

    it("uses file contents for pr review", async () => {
      await withBodyFile(markdownBody, async (file) => {
        mockedGhExec.mockResolvedValue("");

        await prCommand(
          ["review", "123", "--comment", "--body-file", file],
          ctx,
        );

        expect(mockedGhExec).toHaveBeenCalledWith(
          ["pr", "review", "123", "--comment", "--body", markdownBody],
          ctx,
        );
      });
    });

    it("uses file contents for pr comment", async () => {
      await withBodyFile(markdownBody, async (file) => {
        mockedGhExec.mockResolvedValue("");

        await prCommand(["comment", "123", "--body-file", file], ctx);

        expect(mockedGhExec).toHaveBeenCalledWith(
          ["pr", "comment", "123", "--body", markdownBody],
          ctx,
        );
      });
    });

    it("rejects --body and --body-file together before calling gh", async () => {
      await withBodyFile(markdownBody, async (file) => {
        await expect(
          prCommand(
            ["comment", "123", "--body", "inline", "--body-file", file],
            ctx,
          ),
        ).rejects.toThrow(/Use only one body source/);
        expect(mockedGhExec).not.toHaveBeenCalled();
      });
    });
  });

  describe("checks", () => {
    it("returns message when no checks configured", async () => {
      mockedGhJson.mockResolvedValue({ statusCheckRollup: [] });

      const result = await prCommand(["checks", "5"], ctx);

      expect(result).toContain("no CI checks configured");
    });

    it("returns check summary with checks", async () => {
      mockedGhJson.mockResolvedValue({
        statusCheckRollup: [
          { name: "build", conclusion: "SUCCESS" },
          { name: "lint", conclusion: "FAILURE" },
          { name: "test", conclusion: "SKIPPED" },
        ],
      });

      const result = await prCommand(["checks", "5"], ctx);

      expect(result).toContain("1 passed");
      expect(result).toContain("1 failed");
      expect(result).toContain("1 skipped");
      expect(result).toContain("3 total");
    });

    it("keeps an unfinished check run pending", async () => {
      mockedGhJson.mockResolvedValue({
        statusCheckRollup: [
          { name: "build", conclusion: null, status: "IN_PROGRESS" },
        ],
      });

      const result = await prCommand(["checks", "5"], ctx);

      expect(result).toContain("build,pending");
      expect(result).toContain("0 passed, 0 failed, 1 pending");
    });

    it("classifies a successful legacy status context as passing", async () => {
      mockedGhJson.mockResolvedValue({
        statusCheckRollup: [{ context: "Vercel", state: "SUCCESS" }],
      });

      const result = await prCommand(["checks", "5"], ctx);

      expect(result).toContain("Vercel,pass");
      expect(result).toContain("1 passed, 0 failed");
      expect(result).not.toContain("pending");
    });

    it("classifies a failing legacy status context as failing", async () => {
      mockedGhJson.mockResolvedValue({
        statusCheckRollup: [{ context: "Vercel", state: "FAILURE" }],
      });

      const result = await prCommand(["checks", "5"], ctx);

      expect(result).toContain("Vercel,fail");
      expect(result).toContain("0 passed, 1 failed");
      expect(result).not.toContain("pending");
    });

    it("classifies an errored legacy status context as failing", async () => {
      mockedGhJson.mockResolvedValue({
        statusCheckRollup: [{ context: "Vercel", state: "ERROR" }],
      });

      const result = await prCommand(["checks", "5"], ctx);

      expect(result).toContain("Vercel,fail");
      expect(result).toContain("0 passed, 1 failed");
    });

    it("keeps a pending legacy status context pending", async () => {
      mockedGhJson.mockResolvedValue({
        statusCheckRollup: [{ context: "Vercel", state: "PENDING" }],
      });

      const result = await prCommand(["checks", "5"], ctx);

      expect(result).toContain("Vercel,pending");
      expect(result).toContain("0 passed, 0 failed, 1 pending");
    });

    it("classifies a check run that failed to start as failing", async () => {
      mockedGhJson.mockResolvedValue({
        statusCheckRollup: [{ name: "build", conclusion: "STARTUP_FAILURE" }],
      });

      const result = await prCommand(["checks", "5"], ctx);

      expect(result).toContain("build,fail");
      expect(result).toContain("0 passed, 1 failed");
      expect(result).not.toContain("pending");
    });

    it("classifies a stale check run as failing", async () => {
      mockedGhJson.mockResolvedValue({
        statusCheckRollup: [{ name: "build", conclusion: "STALE" }],
      });

      const result = await prCommand(["checks", "5"], ctx);

      expect(result).toContain("build,fail");
      expect(result).toContain("0 passed, 1 failed");
      expect(result).not.toContain("pending");
    });

    it("classifies a cancelled check run as failing", async () => {
      mockedGhJson.mockResolvedValue({
        statusCheckRollup: [{ name: "build", conclusion: "CANCELLED" }],
      });

      const result = await prCommand(["checks", "5"], ctx);

      expect(result).toContain("build,fail");
      expect(result).toContain("0 passed, 1 failed");
      expect(result).not.toContain("pending");
    });

    it("keeps a skipped check run skipped", async () => {
      mockedGhJson.mockResolvedValue({
        statusCheckRollup: [{ name: "build", conclusion: "SKIPPED" }],
      });

      const result = await prCommand(["checks", "5"], ctx);

      expect(result).toContain("build,skip");
      expect(result).toContain("0 passed, 0 failed");
      expect(result).toContain("1 skipped");
    });

    it("counts a mix of check runs and legacy status contexts", async () => {
      mockedGhJson.mockResolvedValue({
        statusCheckRollup: [
          { name: "build", conclusion: "SUCCESS" },
          { name: "test", conclusion: null, status: "IN_PROGRESS" },
          { context: "Vercel", state: "SUCCESS" },
          { context: "ci/circleci", state: "FAILURE" },
        ],
      });

      const result = await prCommand(["checks", "5"], ctx);

      expect(result).toContain("2 passed, 1 failed, 1 pending, 4 total");
    });
  });

  describe("diff", () => {
    it("wraps diff output in TOON envelope", async () => {
      mockedGhExec.mockResolvedValue(
        "diff --git a/file.ts b/file.ts\n+added line\n",
      );

      const result = await prCommand(["diff", "7"], ctx);

      expect(result).toContain("pr_diff:");
      expect(result).toContain("number: 7");
      expect(result).toContain("diff --git");
      expect(result).not.toContain("truncated:");
      expect(result).not.toContain("--full");
    });

    it("truncates large diffs with metadata and --full escape hatch", async () => {
      const largeDiff = "x".repeat(25000);
      mockedGhExec.mockResolvedValue(largeDiff);

      const result = await prCommand(["diff", "7"], ctx);

      expect(result).toContain("truncated: true");
      expect(result).toContain("original_length: 25000");
      expect(result).toContain("pr diff 7 --full");
      expect(result).toContain("to see the complete diff");
    });

    it("skips truncation with --full flag", async () => {
      const largeDiff = "x".repeat(25000);
      mockedGhExec.mockResolvedValue(largeDiff);

      const result = await prCommand(["diff", "7", "--full"], ctx);

      expect(result).not.toContain("truncated:");
      expect(result).not.toContain("original_length");
    });
  });
});
