import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/gh.js", () => ({
  ghJson: vi.fn(),
  ghExec: vi.fn(),
  ghRaw: vi.fn(),
}));

import { ghJson, ghExec } from "../../src/gh.js";
import {
  discussionCommand,
  DISCUSSION_HELP,
} from "../../src/commands/discussion.js";
import type { RepoContext } from "../../src/context.js";

const mockedGhJson = vi.mocked(ghJson);
const mockedGhExec = vi.mocked(ghExec);

const ctx: RepoContext = {
  owner: "octo",
  name: "repo",
  nwo: "octo/repo",
  source: "flag",
};

const BASE = "https://github.com/octo/repo/discussions/66";
const commentUrl = (id: number) => `${BASE}#discussioncomment-${id}`;

function reply(id: number, login: string, createdAt: string, body: string) {
  return {
    id: `DC_${id}`,
    author: { login },
    body,
    createdAt,
    url: commentUrl(id),
    isAnswer: false,
  };
}

/** A discussion shaped like `gh discussion view --json ...,comments`. */
function discussionFixture(overrides: Record<string, unknown> = {}) {
  return {
    number: 66,
    title: "Spec 4.x parity?",
    body: "When will this catch up?",
    state: "OPEN",
    author: { login: "asker" },
    category: { name: "General", isAnswerable: false },
    answered: false,
    createdAt: "2026-09-14T00:00:00Z",
    url: BASE,
    comments: {
      totalCount: 1,
      nodes: [
        {
          ...reply(100, "maintainer", "2026-10-02T21:47:52Z", "1.0.0 is out"),
          replies: {
            // gh returns only the latest few replies; two older ones are cut.
            totalCount: 6,
            nodes: [
              reply(103, "asker", "2026-10-04T00:19:51Z", "third reply"),
              reply(104, "asker", "2026-10-04T00:28:28Z", "fourth reply"),
              reply(105, "maintainer", "2026-10-05T07:12:23Z", "fifth reply"),
              reply(106, "asker", "2026-10-05T07:14:36Z", "sixth reply"),
            ],
          },
        },
      ],
    },
    ...overrides,
  };
}

describe("discussionCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("router", () => {
    it("returns help for --help and no subcommand", async () => {
      expect(await discussionCommand(["--help"])).toBe(DISCUSSION_HELP);
      expect(await discussionCommand([])).toBe(DISCUSSION_HELP);
    });

    it("help says a comment URL posts a reply under that comment", () => {
      expect(DISCUSSION_HELP).toContain(
        "comment with a comment-url posts a reply under that comment",
      );
    });

    it("returns an error for an unknown subcommand", async () => {
      const result = await discussionCommand(["bogus"]);
      expect(result).toContain("Unknown discussion subcommand: bogus");
    });

    it("rejects unknown flags such as --edit before calling gh", async () => {
      await expect(
        discussionCommand(["comment", "66", "--edit", "--body", "x"], ctx),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(mockedGhExec).not.toHaveBeenCalled();
    });
  });

  describe("list", () => {
    it("unwraps gh's {discussions,totalCount} shape and shows a total", async () => {
      mockedGhJson.mockResolvedValue({
        discussions: [
          {
            number: 66,
            title: "Spec parity",
            closed: false,
            category: { name: "General" },
            author: { login: "asker" },
            updatedAt: "2026-10-05T07:14:36Z",
          },
          {
            number: 44,
            title: "Agent integration",
            closed: true,
            category: { name: "Ideas" },
            author: { login: "someone" },
            updatedAt: "2026-10-01T13:13:04Z",
          },
        ],
        totalCount: 9,
        next: "cursor",
      });

      const result = await discussionCommand(
        [
          "list",
          "--state",
          "all",
          "--label",
          "bug",
          "--label",
          "docs",
          "--limit",
          "2",
        ],
        ctx,
      );

      expect(result).toContain("count: 2 of 9 total");
      expect(result).toContain(
        "discussions[2]{number,title,state,category,author,updated}:",
      );
      expect(result).toContain("66,Spec parity,open,General,asker");
      expect(result).toContain("44,Agent integration,closed,Ideas,someone");
      expect(mockedGhJson).toHaveBeenCalledWith(
        [
          "discussion",
          "list",
          "--json",
          "number,title,closed,category,author,updatedAt",
          "--limit",
          "2",
          "--state",
          "all",
          "--label",
          "bug",
          "--label",
          "docs",
        ],
        ctx,
      );
    });

    it("rejects a non-numeric --limit", async () => {
      await expect(
        discussionCommand(["list", "--limit", "lots"], ctx),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it.each(["--state", "--category", "--author", "--limit"])(
      "rejects %s with no value instead of using a default",
      async (flag) => {
        await expect(
          discussionCommand(["list", flag], ctx),
        ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
        expect(mockedGhJson).not.toHaveBeenCalled();
      },
    );
  });

  describe("view", () => {
    it("without --comments shows the comment count and how to read them", async () => {
      mockedGhJson.mockResolvedValue(discussionFixture());

      const result = await discussionCommand(["view", "66"], ctx);

      expect(result).toContain("title: Spec 4.x parity?");
      expect(result).toContain("state: open");
      expect(result).toContain("category: General");
      expect(result).toContain("comment_count: 1");
      expect(result).not.toContain("comments[");
      expect(result).toContain(
        "gh-axi discussion view 66 --comments -R octo/repo",
      );
      // Only one comment is fetched, for its totalCount.
      expect(mockedGhJson).toHaveBeenCalledWith(
        [
          "discussion",
          "view",
          "66",
          "--json",
          "number,title,body,state,author,category,answered,createdAt,url,comments",
          "--limit",
          "1",
        ],
        ctx,
      );
    });

    it("nests replies under each comment, oldest first, with URLs", async () => {
      const fixture = discussionFixture();
      // gh may return replies newest first; output is chronological.
      fixture.comments.nodes[0].replies.nodes.reverse();
      mockedGhJson.mockResolvedValue(fixture);

      const result = await discussionCommand(["view", "66", "--comments"], ctx);

      expect(result).toContain("comments[1]:");
      expect(result).toContain(`url: "${commentUrl(100)}"`);
      expect(result).toContain("replies[4]{author,created,url,body}:");
      const order = [103, 104, 105, 106].map((id) =>
        result.indexOf(commentUrl(id)),
      );
      expect(order.every((pos) => pos > 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      // Replies sit after their parent comment.
      expect(result.indexOf(commentUrl(100))).toBeLessThan(order[0]);
      expect(result).toContain(
        "Run `gh-axi discussion comment '<comment-url>' --body \"...\" -R octo/repo` to reply under a comment",
      );
    });

    it("shows a hidden-reply count and how to see the rest", async () => {
      mockedGhJson.mockResolvedValue(discussionFixture());

      const result = await discussionCommand(["view", "66", "--comments"], ctx);

      expect(result).toContain("reply_count: 6");
      expect(result).toContain("replies_hidden: 2");
      expect(result).toContain(
        `Run \`gh-axi discussion view '${commentUrl(100)}' -R octo/repo\` to see all 6 replies to that comment`,
      );
    });

    it("adds --limit to the hidden-reply hint when a comment has more than 30 replies", async () => {
      const fixture = discussionFixture();
      fixture.comments.nodes[0].replies.totalCount = 120;
      mockedGhJson.mockResolvedValue(fixture);

      const result = await discussionCommand(["view", "66", "--comments"], ctx);

      expect(result).toContain("replies_hidden: 116");
      expect(result).toContain(
        `Run \`gh-axi discussion view '${commentUrl(100)}' --limit 120 -R octo/repo\` to see all 120 replies to that comment`,
      );
    });

    it("shows hidden top-level comments and the --limit that shows them all", async () => {
      const fixture = discussionFixture();
      fixture.comments.totalCount = 45;
      mockedGhJson.mockResolvedValue(fixture);

      const result = await discussionCommand(
        ["view", "66", "--comments", "--limit", "1", "--order", "oldest"],
        ctx,
      );

      expect(result).toContain("comment_count: 45");
      expect(result).toContain("comments_hidden: 44");
      expect(result).toContain(
        "Run `gh-axi discussion view 66 --comments --limit 45 -R octo/repo` to see all 45 comments",
      );
      expect(mockedGhJson).toHaveBeenCalledWith(
        expect.arrayContaining(["--limit", "1", "--order", "oldest"]),
        ctx,
      );
    });

    it("omits hidden counts when every reply is shown", async () => {
      const fixture = discussionFixture();
      fixture.comments.nodes[0].replies.totalCount = 4;
      mockedGhJson.mockResolvedValue(fixture);

      const result = await discussionCommand(["view", "66", "--comments"], ctx);

      expect(result).toContain("reply_count: 4");
      expect(result).not.toContain("replies_hidden");
      expect(result).not.toContain("comments_hidden");
      expect(result).not.toContain("to see all");
    });

    it("treats a comment URL as that comment's full reply thread", async () => {
      const fixture = discussionFixture();
      fixture.comments.nodes[0].replies.totalCount = 50;
      mockedGhJson.mockResolvedValue(fixture);

      const result = await discussionCommand(["view", commentUrl(100)], ctx);

      expect(mockedGhJson).toHaveBeenCalledWith(
        expect.arrayContaining(["view", commentUrl(100), "--limit", "30"]),
        ctx,
      );
      expect(result).toContain("replies_hidden: 46");
      expect(result).toContain(
        `Run \`gh-axi discussion view '${commentUrl(100)}' --limit 50 -R octo/repo\` to see all 50 replies`,
      );
      expect(result).not.toContain("comments_hidden");
    });

    it("marks the accepted answer and answered state on Q&A discussions", async () => {
      const fixture = discussionFixture({
        category: { name: "Q&A", isAnswerable: true },
        answered: true,
      });
      (fixture.comments.nodes[0] as { isAnswer: boolean }).isAnswer = true;
      mockedGhJson.mockResolvedValue(fixture);

      const result = await discussionCommand(["view", "66", "--comments"], ctx);

      expect(result).toContain("answered: yes");
      expect(result).toContain("answer: true");
    });

    it("truncates long bodies unless --full is passed", async () => {
      const long = "x".repeat(2000);
      const fixture = discussionFixture({ body: long });
      mockedGhJson.mockResolvedValue(fixture);
      const truncated = await discussionCommand(["view", "66"], ctx);
      expect(truncated).toContain("truncated");
      expect(truncated).not.toContain(long);

      mockedGhJson.mockResolvedValue(discussionFixture({ body: long }));
      const full = await discussionCommand(["view", "66", "--full"], ctx);
      expect(full).toContain(long);
    });

    it("accepts #66 and rejects a malformed target", async () => {
      mockedGhJson.mockResolvedValue(discussionFixture());
      await discussionCommand(["view", "#66"], ctx);
      expect(mockedGhJson.mock.calls[0][0][2]).toBe("66");

      await expect(
        discussionCommand(["view", "not-a-thing"], ctx),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(discussionCommand(["view"], ctx)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
    });

    it("rejects --limit and --order without --comments or a comment target", async () => {
      await expect(
        discussionCommand(["view", "66", "--limit", "5"], ctx),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(
        discussionCommand(["view", "66", "--comments", "--order", "up"], ctx),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(mockedGhJson).not.toHaveBeenCalled();
    });
    it("scopes repo and follow-ups to the URL's repo, not the checkout", async () => {
      const other = "https://github.com/acme/widgets/discussions/7";
      mockedGhJson.mockResolvedValue(
        discussionFixture({ number: 7, url: other }),
      );
      const gitCtx: RepoContext = { ...ctx, source: "git" };

      const result = await discussionCommand(["view", other], gitCtx);

      expect(result).toContain("repo: acme/widgets");
      expect(result).toContain(
        'gh-axi discussion comment 7 --body "..." -R acme/widgets',
      );
      expect(result).not.toContain("octo/repo");
    });
  });

  describe("comment", () => {
    it("adds a top-level comment to a discussion number", async () => {
      mockedGhExec.mockResolvedValue(`${commentUrl(200)}\n`);

      const result = await discussionCommand(
        ["comment", "66", "--body", "Thanks"],
        ctx,
      );

      expect(mockedGhExec).toHaveBeenCalledWith(
        ["discussion", "comment", "66", "--body", "Thanks"],
        ctx,
      );
      expect(result).toContain("created: comment");
      expect(result).toContain(`url: "${commentUrl(200)}"`);
      expect(result).toContain(
        "gh-axi discussion view 66 --comments -R octo/repo",
      );
    });

    it("passes a comment URL through so gh posts a reply", async () => {
      mockedGhExec.mockResolvedValue(`${commentUrl(201)}\n`);

      const result = await discussionCommand(
        ["comment", commentUrl(100), "--body", "Agreed"],
        ctx,
      );

      expect(mockedGhExec).toHaveBeenCalledWith(
        ["discussion", "comment", commentUrl(100), "--body", "Agreed"],
        ctx,
      );
      expect(result).toContain("created: reply");
      expect(result).toContain(commentUrl(201));
    });

    it("scopes the follow-up to the commented discussion's repo", async () => {
      const other = "https://github.com/acme/widgets/discussions/7";
      mockedGhExec.mockResolvedValue(`${other}#discussioncomment-9\n`);

      const result = await discussionCommand(
        ["comment", other, "--body", "Hi"],
        { ...ctx, source: "git" },
      );

      expect(result).toContain(
        "gh-axi discussion view 7 --comments -R acme/widgets",
      );
    });

    it("reads the body from --body-file", async () => {
      mockedGhExec.mockResolvedValue(`${commentUrl(202)}\n`);
      const dir = mkdtempSync(join(tmpdir(), "gh-axi-discussion-body-"));
      try {
        const file = join(dir, "reply.md");
        writeFileSync(file, "# Reply\n\nfrom a file\n");
        await discussionCommand(
          ["comment", "DC_kwDOabc", "--body-file", file],
          ctx,
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      expect(mockedGhExec).toHaveBeenCalledWith(
        [
          "discussion",
          "comment",
          "DC_kwDOabc",
          "--body",
          "# Reply\n\nfrom a file\n",
        ],
        ctx,
      );
    });

    it("requires a body and never opens gh's editor", async () => {
      await expect(
        discussionCommand(["comment", "66"], ctx),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(
        discussionCommand(["comment", "66", "--body", "a", "--body-file", "b"]),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(mockedGhExec).not.toHaveBeenCalled();
    });
  });
});
