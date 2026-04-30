import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/gh.js", () => ({
  ghJson: vi.fn(),
  ghExec: vi.fn(),
  ghRaw: vi.fn(),
}));

import { ghJson, ghExec } from "../../src/gh.js";
import { prCommand, PR_HELP } from "../../src/commands/pr.js";
import { AxiError } from "../../src/errors.js";
import type { RepoContext } from "../../src/context.js";

const mockedGhJson = vi.mocked(ghJson);
const mockedGhExec = vi.mocked(ghExec);

const ctx: RepoContext = {
  owner: "octo",
  name: "repo",
  nwo: "octo/repo",
  source: "flag",
};

describe("prCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
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
      });

      const result = await prCommand(["merge", "10"], ctx);

      expect(result).toContain("merged");
      expect(result).toContain("alice");
      expect(mockedGhExec).not.toHaveBeenCalled();
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
