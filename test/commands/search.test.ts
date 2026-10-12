import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/gh.js", () => ({
  ghJson: vi.fn(),
  ghExec: vi.fn(),
  ghRaw: vi.fn(),
}));

import { ghJson } from "../../src/gh.js";
import { searchCommand, SEARCH_HELP } from "../../src/commands/search.js";
import { AxiError } from "../../src/errors.js";
import type { RepoContext } from "../../src/context.js";

const mockedGhJson = vi.mocked(ghJson);

const ctx: RepoContext = {
  owner: "octo",
  name: "repo",
  nwo: "octo/repo",
  source: "flag",
};

describe("searchCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("router", () => {
    it("returns help when --help is passed", async () => {
      const result = await searchCommand(["--help"]);
      expect(result).toBe(SEARCH_HELP);
    });

    it("returns help when no subcommand is given", async () => {
      const result = await searchCommand([]);
      expect(result).toBe(SEARCH_HELP);
    });

    it("returns error for unknown type", async () => {
      const result = await searchCommand(["unknown", "query"]);
      expect(result).toContain("Unknown search type: unknown");
    });
  });

  describe("searchIssues", () => {
    it("requires query", async () => {
      await expect(searchCommand(["issues"])).rejects.toThrow(AxiError);
    });

    it.each(["issues", "prs", "repos", "commits", "code"])(
      "rejects a blank %s query without calling gh",
      async (type) => {
        await expect(searchCommand([type, "", " "])).rejects.toThrow(
          "Search query or filters required",
        );
        expect(mockedGhJson).not.toHaveBeenCalled();
      },
    );

    it("returns results with count", async () => {
      mockedGhJson.mockResolvedValue([
        {
          number: 1,
          title: "Bug",
          repository: { nameWithOwner: "octo/repo" },
          state: "OPEN",
          author: { login: "alice" },
          labels: [],
          createdAt: "2024-01-01T00:00:00Z",
        },
        {
          number: 2,
          title: "Feature",
          repository: { nameWithOwner: "octo/repo" },
          state: "CLOSED",
          author: { login: "bob" },
          labels: [],
          createdAt: "2024-01-02T00:00:00Z",
        },
      ]);

      const result = await searchCommand(["issues", "test query"], ctx);

      expect(result).toContain("count: 2");
      expect(result).toContain("Bug");
      expect(result).toContain("Feature");
    });

    it("keeps query after equals-form filters", async () => {
      mockedGhJson.mockResolvedValue([]);

      await searchCommand(["issues", "--repo=owner/repo", "bug"]);

      expect(mockedGhJson).toHaveBeenCalledWith([
        "search",
        "issues",
        "--json",
        "number,title,repository,state,author,labels,createdAt",
        "--limit",
        "1000",
        "--repo",
        "owner/repo",
        "--",
        "bug",
      ]);
    });

    it("forwards a negated qualifier behind --", async () => {
      mockedGhJson.mockResolvedValue([]);

      await searchCommand(["issues", "bug", "--", "-label:wontfix"]);

      const ghArgs = mockedGhJson.mock.calls[0][0];
      expect(ghArgs.slice(-3)).toEqual(["--", "bug", "-label:wontfix"]);
    });

    it("forwards each positional as its own gh argument", async () => {
      mockedGhJson.mockResolvedValue([]);

      await searchCommand([
        "prs",
        "review-requested:@me",
        "created:>=2026-01-01",
        "--state",
        "open",
      ]);

      const ghArgs = mockedGhJson.mock.calls[0][0];
      expect(ghArgs.slice(-3)).toEqual([
        "--",
        "review-requested:@me",
        "created:>=2026-01-01",
      ]);
    });

    it("keeps query after boolean filters", async () => {
      mockedGhJson.mockResolvedValue([]);

      await searchCommand(["prs", "--draft", "bug"]);

      expect(mockedGhJson).toHaveBeenCalledWith(
        expect.arrayContaining(["bug"]),
      );
    });
  });

  describe("--fields", () => {
    const prItem = {
      number: 7,
      title: "Add thing",
      repository: { nameWithOwner: "octo/repo" },
      state: "OPEN",
      author: { login: "alice" },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: new Date().toISOString(),
      url: "https://github.com/octo/repo/pull/7",
      isDraft: true,
      labels: [{ name: "bug" }, { name: "ui" }],
    };

    it("keeps the default prs --json set when --fields is not passed", async () => {
      mockedGhJson.mockResolvedValue([]);

      await searchCommand(["prs", "x"], ctx);

      const ghArgs = mockedGhJson.mock.calls[0][0];
      expect(ghArgs[ghArgs.indexOf("--json") + 1]).toBe(
        "number,title,repository,state,author,createdAt",
      );
    });

    it("extends prs --json and columns with the requested fields", async () => {
      mockedGhJson.mockResolvedValue([prItem]);

      const result = await searchCommand(
        ["prs", "x", "--owner", "octo", "--fields", "updatedAt,url,isDraft,labels"],
        ctx,
      );

      const ghArgs = mockedGhJson.mock.calls[0][0];
      expect(ghArgs[ghArgs.indexOf("--json") + 1]).toBe(
        "number,title,repository,state,author,createdAt,updatedAt,url,isDraft,labels",
      );
      expect(ghArgs.slice(-2)).toEqual(["--", "x"]);
      expect(result).toContain(
        "prs[1]{number,title,repo,state,author,created,updated_at,url,draft,labels}:",
      );
      expect(result).toContain("https://github.com/octo/repo/pull/7");
      expect(result).toContain("yes");
      expect(result).toContain("bug,ui");
    });

    it("accepts --fields=<a,b> and keeps the query", async () => {
      mockedGhJson.mockResolvedValue([]);

      await searchCommand(["issues", "--fields=url,commentsCount", "bug"], ctx);

      const ghArgs = mockedGhJson.mock.calls[0][0];
      expect(ghArgs[ghArgs.indexOf("--json") + 1]).toBe(
        "number,title,repository,state,author,labels,createdAt,url,commentsCount",
      );
      expect(ghArgs.slice(-2)).toEqual(["--", "bug"]);
    });

    it("shows closed_at as none for an open item's zero-time closedAt", async () => {
      mockedGhJson.mockResolvedValue([
        { ...prItem, number: 1, closedAt: "0001-01-01T00:00:00Z" },
        { ...prItem, number: 2, closedAt: new Date().toISOString() },
      ]);

      const result = await searchCommand(
        ["issues", "x", "--fields", "closedAt"],
        ctx,
      );

      const rows = result.split("\n").filter((l) => /^ {2}[12],/.test(l));
      expect(rows[0]).toMatch(/,none$/);
      expect(rows[1]).toMatch(/,just now$/);
    });

    it("does not treat the --fields value as query text", async () => {
      mockedGhJson.mockResolvedValue([]);

      await expect(
        searchCommand(["issues", "--fields", "url"], ctx),
      ).rejects.toThrow("Search query or filters required");
      expect(mockedGhJson).not.toHaveBeenCalled();
    });

    it.each([
      ["issues", "isDraft"],
      ["prs", "fakeField"],
    ])(
      "rejects an unknown %s field %s without calling gh",
      async (type, name) => {
        await expect(
          searchCommand([type, "x", "--fields", name], ctx),
        ).rejects.toThrow(`Unknown field(s): ${name}`);
        expect(mockedGhJson).not.toHaveBeenCalled();
      },
    );

    it.each(["repos", "commits", "code"])(
      "still rejects --fields on search %s",
      async (type) => {
        await expect(
          searchCommand([type, "x", "--fields", "url"], ctx),
        ).rejects.toThrow("--fields");
        expect(mockedGhJson).not.toHaveBeenCalled();
      },
    );
  });

  describe("searchRepos", () => {
    it("returns results", async () => {
      mockedGhJson.mockResolvedValue([
        {
          fullName: "octo/repo",
          description: "A test repo",
          stargazersCount: 100,
          forksCount: 10,
          language: "TypeScript",
          updatedAt: "2024-01-01T00:00:00Z",
        },
      ]);

      const result = await searchCommand(["repos", "typescript"], ctx);

      expect(result).toContain("octo/repo");
      expect(result).toContain("A test repo");
    });

    it("emits count line", async () => {
      mockedGhJson.mockResolvedValue([
        {
          fullName: "octo/repo1",
          description: "",
          stargazersCount: 10,
          forksCount: 1,
          language: "TypeScript",
          updatedAt: "2024-01-01T00:00:00Z",
        },
        {
          fullName: "octo/repo2",
          description: "",
          stargazersCount: 5,
          forksCount: 0,
          language: "Go",
          updatedAt: "2024-01-02T00:00:00Z",
        },
      ]);

      const result = await searchCommand(["repos", "test"], ctx);

      expect(result).toContain("count: 2");
    });

    it("shows display-limited hint when results exceed display limit", async () => {
      // DISPLAY_LIMIT is 30; create 35 results
      const items = Array.from({ length: 35 }, (_, i) => ({
        fullName: `octo/repo-${i}`,
        description: "",
        stargazersCount: 0,
        forksCount: 0,
        language: null,
        updatedAt: "2024-01-01T00:00:00Z",
      }));
      mockedGhJson.mockResolvedValue(items);

      const result = await searchCommand(["repos", "test"], ctx);

      expect(result).toContain("count: 35");
      expect(result).toContain("showing first 30");
    });

    it("shows API limit hint when result count equals search limit", async () => {
      // Default search limit is 1000
      const items = Array.from({ length: 1000 }, (_, i) => ({
        fullName: `octo/repo-${i}`,
        description: "",
        stargazersCount: 0,
        forksCount: 0,
        language: null,
        updatedAt: "2024-01-01T00:00:00Z",
      }));
      mockedGhJson.mockResolvedValue(items);

      const result = await searchCommand(["repos", "test"], ctx);

      expect(result).toContain("1000+");
    });
  });

  describe("searchCommits", () => {
    it("uses repo context when no explicit --repo flag is passed", async () => {
      mockedGhJson.mockResolvedValue([]);

      await searchCommand(["commits", "fix"], ctx);

      expect(mockedGhJson).toHaveBeenCalledWith(
        expect.arrayContaining(["--repo", "octo/repo"]),
      );
    });

    it("emits count line", async () => {
      mockedGhJson.mockResolvedValue([
        {
          sha: "abc123",
          commit: {
            message: "fix bug",
            author: { date: "2024-01-01T00:00:00Z" },
          },
          repository: { fullName: "octo/repo" },
          author: { login: "alice" },
        },
      ]);

      const result = await searchCommand(["commits", "fix"], ctx);

      expect(result).toContain("count: 1");
    });

    it("shows display-limited hint when results exceed display limit", async () => {
      const items = Array.from({ length: 35 }, (_, i) => ({
        sha: `abc${i}`,
        commit: {
          message: `commit ${i}`,
          author: { date: "2024-01-01T00:00:00Z" },
        },
        repository: { fullName: "octo/repo" },
        author: { login: "alice" },
      }));
      mockedGhJson.mockResolvedValue(items);

      const result = await searchCommand(["commits", "fix"], ctx);

      expect(result).toContain("count: 35");
      expect(result).toContain("showing first 30");
    });

    it("shows API limit hint when result count equals search limit", async () => {
      const items = Array.from({ length: 1000 }, (_, i) => ({
        sha: `abc${i}`,
        commit: {
          message: `commit ${i}`,
          author: { date: "2024-01-01T00:00:00Z" },
        },
        repository: { fullName: "octo/repo" },
        author: { login: "alice" },
      }));
      mockedGhJson.mockResolvedValue(items);

      const result = await searchCommand(["commits", "fix"], ctx);

      expect(result).toContain("1000+");
    });
  });

  describe("searchCode", () => {
    it("uses repo context when no explicit --repo flag is passed", async () => {
      mockedGhJson.mockResolvedValue([]);

      await searchCommand(["code", "function"], ctx);

      expect(mockedGhJson).toHaveBeenCalledWith(
        expect.arrayContaining(["--repo", "octo/repo"]),
      );
    });

    it("emits count line", async () => {
      mockedGhJson.mockResolvedValue([
        {
          path: "src/main.ts",
          repository: { fullName: "octo/repo" },
          textMatches: [{ type: "FileContent" }],
        },
        {
          path: "src/utils.ts",
          repository: { fullName: "octo/repo" },
          textMatches: [{ type: "FileContent" }],
        },
      ]);

      const result = await searchCommand(["code", "function"], ctx);

      expect(result).toContain("count: 2");
    });

    it("shows display-limited hint when results exceed display limit", async () => {
      const items = Array.from({ length: 35 }, (_, i) => ({
        path: `src/file${i}.ts`,
        repository: { fullName: "octo/repo" },
        textMatches: [{ type: "FileContent" }],
      }));
      mockedGhJson.mockResolvedValue(items);

      const result = await searchCommand(["code", "function"], ctx);

      expect(result).toContain("count: 35");
      expect(result).toContain("showing first 30");
    });

    it("shows API limit hint when result count equals search limit", async () => {
      const items = Array.from({ length: 1000 }, (_, i) => ({
        path: `src/file${i}.ts`,
        repository: { fullName: "octo/repo" },
        textMatches: [{ type: "FileContent" }],
      }));
      mockedGhJson.mockResolvedValue(items);

      const result = await searchCommand(["code", "function"], ctx);

      expect(result).toContain("1000+");
    });
  });
});
