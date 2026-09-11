import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/glab.js", () => ({
  glabJson: vi.fn(),
  glabExec: vi.fn(),
}));

import { glabJson, glabExec } from "../../src/glab.js";
import { issueCommand, ISSUE_HELP, ISSUE_FLAGS } from "../../src/commands/issue.js";
import { AxiError, MutationFollowupError } from "../../src/errors.js";
import type { ProjectContext } from "../../src/context.js";

const mockedGlabJson = vi.mocked(glabJson);
const mockedGlabExec = vi.mocked(glabExec);

const ctx: ProjectContext = { fullPath: "group/project", source: "flag" };

/** One minute ago, so relativeTime renders deterministically as "1m ago". */
const RECENT = new Date(Date.now() - 60_000).toISOString();

const OPEN_ISSUE = {
  iid: 42,
  title: "Broken login",
  state: "opened",
  author: { username: "alice" },
  created_at: RECENT,
  description: "Steps to reproduce",
  labels: ["bug"],
  web_url: "https://gitlab.com/group/project/-/issues/42",
};

describe("issueCommand router", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns help for --help/-h/no subcommand", async () => {
    expect(await issueCommand(["--help"])).toContain(ISSUE_HELP);
    expect(await issueCommand(["-h"])).toContain(ISSUE_HELP);
    expect(await issueCommand([])).toContain(ISSUE_HELP);
  });

  it("returns an error block for unknown subcommands", async () => {
    const result = await issueCommand(["reopen", "1"]);
    expect(result).toContain("Unknown issue subcommand: reopen");
    expect(result).toContain("Available subcommands: list, view, create, close");
  });
});

describe("issue list", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("requests machine-readable output with -O json (its -F means details|ids|urls)", async () => {
    mockedGlabJson.mockResolvedValueOnce([]);
    await issueCommand(["list"], ctx);
    expect(mockedGlabJson).toHaveBeenCalledWith(
      ["issue", "list", "-O", "json", "--per-page", "30"],
      ctx,
    );
  });

  it("renders a count line and a TOON list", async () => {
    mockedGlabJson.mockResolvedValueOnce([
      { ...OPEN_ISSUE },
      { ...OPEN_ISSUE, iid: 43, state: "closed" },
    ]);
    const result = await issueCommand(["list"], ctx);
    expect(result).toContain("count: 2");
    expect(result).toContain("issues[2]{iid,title,state,author,created}:");
    expect(result).toContain("42,Broken login,opened,alice,1m ago");
    expect(result).toContain("43,Broken login,closed,alice,1m ago");
  });

  it("translates --state into glab list filters (opened needs none)", async () => {
    mockedGlabJson.mockResolvedValue([]);
    await issueCommand(["list", "--state", "closed"], ctx);
    let args = mockedGlabJson.mock.calls[0]?.[0] as string[];
    expect(args).toContain("--closed");

    await issueCommand(["list", "--state", "all"], ctx);
    args = mockedGlabJson.mock.calls[1]?.[0] as string[];
    expect(args).toContain("--all");

    await issueCommand(["list", "--state", "opened"], ctx);
    args = mockedGlabJson.mock.calls[2]?.[0] as string[];
    expect(args).not.toContain("--all");
    expect(args).not.toContain("--closed");
  });

  it("rejects an invalid --state (GitLab issues have no merged state)", async () => {
    await expect(
      issueCommand(["list", "--state", "merged"], ctx),
    ).rejects.toThrow(/opened, closed, all/);
  });

  it("rejects a second --assignee, which glab would silently discard", async () => {
    await expect(
      issueCommand(["list", "--assignee", "alice", "--assignee", "bob"], ctx),
    ).rejects.toThrow(/--assignee may only be given once/);
    expect(mockedGlabJson).not.toHaveBeenCalled();
  });

  it("clamps --limit to GitLab's page cap and marks the page truncated", async () => {
    mockedGlabJson.mockResolvedValueOnce(
      Array.from({ length: 100 }, (_, i) => ({ ...OPEN_ISSUE, iid: i + 1 })),
    );
    const result = await issueCommand(["list", "--limit", "500"], ctx);
    const args = mockedGlabJson.mock.calls[0]?.[0] as string[];
    expect(args[args.indexOf("--per-page") + 1]).toBe("100");
    expect(result).toContain("count: 100 (showing first 100)");
  });

  it("forwards repeatable labels and a single assignee", async () => {
    mockedGlabJson.mockResolvedValueOnce([]);
    await issueCommand(
      ["list", "--label", "bug", "--label=backend", "--assignee", "alice", "--author", "bob"],
      ctx,
    );
    const args = mockedGlabJson.mock.calls[0]?.[0] as string[];
    expect(args).toEqual([
      "issue", "list", "-O", "json", "--per-page", "30",
      "--label", "bug", "--label", "backend",
      "--assignee", "alice",
      "--author", "bob",
    ]);
  });

  it("adds extra --fields columns to the output", async () => {
    mockedGlabJson.mockResolvedValueOnce([{ ...OPEN_ISSUE }]);
    const result = await issueCommand(["list", "--fields", "url,labels"], ctx);
    expect(result).toContain(
      "issues[1]{iid,title,state,author,created,url,labels}:",
    );
    expect(result).toContain("bug");
    expect(result).toContain("https://gitlab.com/group/project/-/issues/42");
  });

  it("refuses a dangling --label instead of filtering by the next flag", async () => {
    await expect(
      issueCommand(["list", "--label", "--state", "closed"], ctx),
    ).rejects.toThrow(/--label requires a value/);
    expect(mockedGlabJson).not.toHaveBeenCalled();
  });

  it("rejects unknown --fields entries", async () => {
    await expect(
      issueCommand(["list", "--fields", "nope"], ctx),
    ).rejects.toThrow(/Unknown --fields entry: nope/);
  });
});

describe("issue view", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("fetches with the number and -F json and renders detail", async () => {
    mockedGlabJson.mockResolvedValueOnce({ ...OPEN_ISSUE });
    const result = await issueCommand(["view", "42"], ctx);
    expect(mockedGlabJson).toHaveBeenCalledWith(
      ["issue", "view", "42", "-F", "json"],
      ctx,
    );
    expect(result).toContain("issue:");
    expect(result).toContain("iid: 42");
    expect(result).toContain("title: Broken login");
    expect(result).toContain("state: opened");
    expect(result).toContain("author: alice");
    expect(result).toContain("labels: bug");
  });

  it("suggests closing an open issue", async () => {
    mockedGlabJson.mockResolvedValueOnce({ ...OPEN_ISSUE });
    const result = await issueCommand(["view", "42"], ctx);
    expect(result).toContain("glab-axi issue close 42 -R group/project");
  });

  it("suggests the closed list for a closed issue", async () => {
    mockedGlabJson.mockResolvedValueOnce({ ...OPEN_ISSUE, state: "closed" });
    const result = await issueCommand(["view", "42"], ctx);
    expect(result).toContain("glab-axi issue list --state closed -R group/project");
  });

  it("rejects --full=true instead of silently truncating", async () => {
    await expect(
      issueCommand(["view", "42", "--full=true"], ctx),
    ).rejects.toThrow(/--full=true/);
    expect(mockedGlabJson).not.toHaveBeenCalled();
  });

  it("truncates by default and --full keeps everything", async () =>{
    mockedGlabJson.mockResolvedValueOnce({
      ...OPEN_ISSUE,
      description: "z".repeat(600),
    });
    const truncated = await issueCommand(["view", "42"], ctx);
    expect(truncated).toContain("(truncated, use --full)");

    mockedGlabJson.mockResolvedValueOnce({
      ...OPEN_ISSUE,
      description: "z".repeat(600),
    });
    const full = await issueCommand(["view", "42", "--full"], ctx);
    expect(full).not.toContain("(truncated");
  });

  it("rejects unknown flags", async () => {
    await expect(issueCommand(["view", "42", "--comments"], ctx)).rejects.toThrow(
      /unknown flag for glab-axi issue view: --comments/,
    );
  });
});

describe("issue create", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("requires --title", async () => {
    await expect(issueCommand(["create"], ctx)).rejects.toThrow(
      /--title is required/,
    );
  });

  it("creates headlessly (title, description, --yes) and reads back the issue", async () => {
    mockedGlabExec.mockResolvedValueOnce(
      "issue 42 created: https://gitlab.com/group/project/-/issues/42",
    );
    mockedGlabJson.mockResolvedValueOnce({ ...OPEN_ISSUE });
    const result = await issueCommand(
      ["create", "--title", "Broken login", "--description", "Body"],
      ctx,
    );
    expect(mockedGlabExec).toHaveBeenCalledWith(
      [
        "issue", "create",
        "--title", "Broken login",
        "--description", "Body",
        "--yes",
      ],
      ctx,
    );
    expect(mockedGlabJson).toHaveBeenCalledWith(
      ["issue", "view", "42", "-F", "json"],
      ctx,
    );
    expect(result).toContain("iid: 42");
    expect(result).toContain("title: Broken login");
    expect(result).toContain("state: opened");
  });

  it("always forwards a concrete description so glab never opens an editor", async () => {
    mockedGlabExec.mockResolvedValueOnce(
      "https://gitlab.com/group/project/-/issues/42",
    );
    mockedGlabJson.mockResolvedValueOnce({ ...OPEN_ISSUE });
    await issueCommand(["create", "--title", "T"], ctx);
    const args = mockedGlabExec.mock.calls[0]?.[0] as string[];
    const descIdx = args.indexOf("--description");
    expect(descIdx).toBeGreaterThan(-1);
    expect(args[descIdx + 1]).toBe("");
    expect(args).toContain("--yes");
  });

  it("forwards assignees, labels, and milestones", async () => {
    mockedGlabExec.mockResolvedValueOnce(
      "https://gitlab.com/group/project/-/issues/42",
    );
    mockedGlabJson.mockResolvedValueOnce({ ...OPEN_ISSUE });
    await issueCommand(
      [
        "create", "--title", "T",
        "--assignee", "alice", "--assignee", "carol",
        "--label", "bug", "--label", "backend",
        "--milestone", "7",
      ],
      ctx,
    );
    const args = mockedGlabExec.mock.calls[0]?.[0] as string[];
    expect(args).toContain("--assignee");
    expect(args).toEqual(
      expect.arrayContaining(["--assignee", "alice", "--assignee", "carol", "--label", "bug", "--label", "backend", "--milestone", "7"]),
    );
  });

  it("raises MutationFollowupError when the read-back fails", async () => {
    mockedGlabExec.mockResolvedValueOnce(
      "https://gitlab.com/group/project/-/issues/42",
    );
    mockedGlabJson.mockRejectedValueOnce(
      new AxiError("view blew up", "NOT_FOUND"),
    );
    await expect(
      issueCommand(["create", "--title", "T"], ctx),
    ).rejects.toBeInstanceOf(MutationFollowupError);
  });
});

describe("issue close", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("is a no-op when already closed (exact state match)", async () => {
    mockedGlabJson.mockResolvedValueOnce({ ...OPEN_ISSUE, state: "closed" });
    const result = await issueCommand(["close", "42"], ctx);
    expect(mockedGlabExec).not.toHaveBeenCalled();
    expect(result).toContain("message: Already closed");
    expect(result).toContain("state: closed");
  });

  it("closes an opened issue and reads back the state", async () => {
    mockedGlabJson
      .mockResolvedValueOnce({ ...OPEN_ISSUE })
      .mockResolvedValueOnce({ ...OPEN_ISSUE, state: "closed" });
    const result = await issueCommand(["close", "42"], ctx);
    expect(mockedGlabExec).toHaveBeenCalledWith(["issue", "close", "42"], ctx);
    expect(result).toContain("state: closed");
    expect(result).toContain("help[1]:");
  });

  it("proceeds when the state cannot be read (degrades, never false-positives)", async () => {
    mockedGlabJson
      .mockResolvedValueOnce({ iid: 42 })
      .mockResolvedValueOnce({ ...OPEN_ISSUE, state: "closed" });
    await issueCommand(["close", "42"], ctx);
    expect(mockedGlabExec).toHaveBeenCalled();
  });

  it("requires a number", async () => {
    await expect(issueCommand(["close", "abc"], ctx)).rejects.toThrow(
      /Invalid issue number: abc/,
    );
  });
});

describe("ISSUE_FLAGS covers the documented interface", () => {
  it("declares flags for every documented subcommand", () => {
    expect(Object.keys(ISSUE_FLAGS).sort()).toEqual([
      "close", "create", "list", "view",
    ]);
  });
});
