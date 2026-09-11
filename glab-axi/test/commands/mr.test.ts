import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/glab.js", () => ({
  glabJson: vi.fn(),
  glabExec: vi.fn(),
}));

import { glabJson, glabExec } from "../../src/glab.js";
import { mrCommand, MR_HELP, MR_FLAGS } from "../../src/commands/mr.js";
import { AxiError, MutationFollowupError } from "../../src/errors.js";
import type { ProjectContext } from "../../src/context.js";

const mockedGlabJson = vi.mocked(glabJson);
const mockedGlabExec = vi.mocked(glabExec);

const ctx: ProjectContext = { fullPath: "group/project", source: "flag" };

/** One minute ago, so relativeTime renders deterministically as "1m ago". */
const RECENT = new Date(Date.now() - 60_000).toISOString();

const OPEN_MR = {
  iid: 42,
  title: "Fix login",
  state: "opened",
  author: { username: "alice" },
  created_at: RECENT,
  description: "Steps to reproduce",
  draft: false,
  source_branch: "fix-login",
  target_branch: "main",
  labels: ["bug"],
  web_url: "https://gitlab.com/group/project/-/merge_requests/42",
  merged_at: null,
  merged_by: null,
  merge_user: null,
};

function mergedMr(): Record<string, unknown> {
  return {
    ...OPEN_MR,
    state: "merged",
    merged_at: "2024-02-01T00:00:00Z",
    merged_by: { username: "bob" },
    merge_user: { username: "bob" },
  };
}

describe("mrCommand router", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns help when --help is passed", async () => {
    expect(await mrCommand(["--help"])).toContain(MR_HELP);
    expect(await mrCommand(["-h"])).toContain(MR_HELP);
    expect(await mrCommand([])).toContain(MR_HELP);
  });

  it("returns an error block (not a throw) for unknown subcommands", async () => {
    const result = await mrCommand(["unknown"]);
    expect(result).toContain("Unknown mr subcommand: unknown");
    expect(result).toContain("VALIDATION_ERROR");
  });

  it("rejects unknown flags per subcommand", async () => {
    await expect(mrCommand(["list", "--bogus"], ctx)).rejects.toThrow(
      /unknown flag for glab-axi mr list: --bogus/,
    );
  });
});

describe("mr list", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("renders a count line and a TOON list", async () => {
    mockedGlabJson.mockResolvedValueOnce([
      { ...OPEN_MR },
      { ...OPEN_MR, iid: 43, state: "merged", draft: true },
    ]);
    const result = await mrCommand(["list"], ctx);
    expect(result).toContain("count: 2");
    expect(result).toContain("mrs[2]{iid,title,state,author,created,draft}:");
    expect(result).toContain("42,Fix login,opened,alice,1m ago,no");
    expect(result).toContain("43,Fix login,merged,alice,1m ago,yes");
  });

  it("requests machine-readable output with -F json and a per-page limit", async () => {
    mockedGlabJson.mockResolvedValueOnce([]);
    await mrCommand(["list", "--limit", "5"], ctx);
    expect(mockedGlabJson).toHaveBeenCalledWith(
      ["mr", "list", "-F", "json", "--per-page", "5"],
      ctx,
    );
  });

  it("translates --state into glab list filters (opened needs none)", async () => {
    mockedGlabJson.mockResolvedValue([]);
    await mrCommand(["list", "--state", "opened"], ctx);
    let args = mockedGlabJson.mock.calls[0]?.[0] as string[];
    expect(args).not.toContain("--all");
    expect(args).not.toContain("--closed");
    expect(args).not.toContain("--merged");

    await mrCommand(["list", "--state", "closed"], ctx);
    args = mockedGlabJson.mock.calls[1]?.[0] as string[];
    expect(args).toContain("--closed");

    await mrCommand(["list", "--state", "merged"], ctx);
    args = mockedGlabJson.mock.calls[2]?.[0] as string[];
    expect(args).toContain("--merged");

    await mrCommand(["list", "--state", "all"], ctx);
    args = mockedGlabJson.mock.calls[3]?.[0] as string[];
    expect(args).toContain("--all");
  });

  it("rejects an invalid --state with the allowed values", async () => {
    await expect(mrCommand(["list", "--state", "bogus"], ctx)).rejects.toThrow(
      /opened, closed, merged, all/,
    );
    expect(mockedGlabJson).not.toHaveBeenCalled();
  });

  it("forwards repeatable labels and assignees once per value", async () => {
    mockedGlabJson.mockResolvedValueOnce([]);
    await mrCommand(
      ["list", "--label", "bug", "--label=backend", "--assignee", "alice"],
      ctx,
    );
    const args = mockedGlabJson.mock.calls[0]?.[0] as string[];
    expect(args).toEqual([
      "mr", "list", "-F", "json", "--per-page", "30",
      "--label", "bug", "--label", "backend",
      "--assignee", "alice",
    ]);
  });

  it("adds extra --fields columns to the output", async () => {
    mockedGlabJson.mockResolvedValueOnce([{ ...OPEN_MR }]);
    const result = await mrCommand(
      ["list", "--fields", "url,labels"],
      ctx,
    );
    expect(result).toContain("mrs[1]{iid,title,state,author,created,draft,url,labels}:");
    expect(result).toContain("bug");
    expect(result).toContain("https://gitlab.com/group/project/-/merge_requests/42");
  });

  it("rejects unknown --fields entries", async () => {
    mockedGlabJson.mockResolvedValueOnce([]);
    await expect(
      mrCommand(["list", "--fields", "nope"], ctx),
    ).rejects.toThrow(/Unknown --fields entry: nope/);
  });

  it("appends follow-up suggestions", async () => {
    mockedGlabJson.mockResolvedValueOnce([{ ...OPEN_MR }]);
    const result = await mrCommand(["list"], ctx);
    expect(result).toContain("help[2]:");
    expect(result).toContain("mr view <number>");
    expect(result).toContain("mr create --title");
  });
});

describe("mr view", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("fetches with the number and -F json and renders detail", async () => {
    mockedGlabJson.mockResolvedValueOnce({ ...OPEN_MR });
    const result = await mrCommand(["view", "42"], ctx);
    expect(mockedGlabJson).toHaveBeenCalledWith(
      ["mr", "view", "42", "-F", "json"],
      ctx,
    );
    expect(result).toContain("mr:");
    expect(result).toContain("iid: 42");
    expect(result).toContain("title: Fix login");
    expect(result).toContain("state: opened");
    expect(result).toContain("author: alice");
    expect(result).toContain("source_branch: fix-login");
    expect(result).toContain("target_branch: main");
    expect(result).toContain("merged: no");
    expect(result).toContain("bug");
  });

  it("suggests the next action for an open MR", async () => {
    mockedGlabJson.mockResolvedValueOnce({ ...OPEN_MR });
    const result = await mrCommand(["view", "42"], ctx);
    expect(result).toContain("glab-axi mr merge 42 -R group/project");
    expect(result).toContain("glab-axi mr close 42 -R group/project");
  });

  it("suggests reopening a closed MR and nothing for a merged one", async () => {
    mockedGlabJson.mockResolvedValueOnce({ ...OPEN_MR, state: "closed" });
    const closed = await mrCommand(["view", "42"], ctx);
    expect(closed).toContain("glab-axi mr reopen 42 -R group/project");

    mockedGlabJson.mockResolvedValueOnce(mergedMr());
    const merged = await mrCommand(["view", "42"], ctx);
    expect(merged).not.toContain("help[");
  });

  it("truncates a long description by default", async () => {
    mockedGlabJson.mockResolvedValueOnce({
      ...OPEN_MR,
      description: "y".repeat(600),
    });
    const result = await mrCommand(["view", "42"], ctx);
    expect(result).toContain("... (truncated, use --full)");
  });

  it("--full keeps the complete description", async () => {
    mockedGlabJson.mockResolvedValueOnce({
      ...OPEN_MR,
      description: "y".repeat(600),
    });
    const result = await mrCommand(["view", "42", "--full"], ctx);
    expect(result).not.toContain("(truncated");
    expect(result).toContain("y".repeat(600));
  });

  it("requires a number", async () => {
    mockedGlabJson.mockResolvedValueOnce({ ...OPEN_MR });
    await expect(mrCommand(["view"], ctx)).rejects.toThrow(
      /Missing merge request number/,
    );
  });
});

describe("mr create", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("requires --title", async () => {
    await expect(mrCommand(["create"], ctx)).rejects.toThrow(
      /--title is required/,
    );
  });

  it("creates headlessly (title, description, --yes) and reads back the MR", async () => {
    mockedGlabExec.mockResolvedValueOnce(
      "!42 Fix login: https://gitlab.com/group/project/-/merge_requests/42",
    );
    mockedGlabJson.mockResolvedValueOnce({ ...OPEN_MR });
    const result = await mrCommand(
      ["create", "--title", "Fix login", "--description", "Body"],
      ctx,
    );
    expect(mockedGlabExec).toHaveBeenCalledWith(
      [
        "mr", "create",
        "--title", "Fix login",
        "--description", "Body",
        "--yes",
      ],
      ctx,
    );
    expect(mockedGlabJson).toHaveBeenCalledWith(
      ["mr", "view", "42", "-F", "json"],
      ctx,
    );
    expect(result).toContain("iid: 42");
    expect(result).toContain("title: Fix login");
    expect(result).toContain("state: opened");
    expect(result).toContain(
      "https://gitlab.com/group/project/-/merge_requests/42",
    );
  });

  it("always forwards a concrete description so glab never opens an editor", async () => {
    mockedGlabExec.mockResolvedValueOnce(
      "https://gitlab.com/group/project/-/merge_requests/7",
    );
    mockedGlabJson.mockResolvedValueOnce({ ...OPEN_MR, iid: 7 });
    await mrCommand(["create", "--title", "T"], ctx);
    const args = mockedGlabExec.mock.calls[0]?.[0] as string[];
    const descIdx = args.indexOf("--description");
    expect(descIdx).toBeGreaterThan(-1);
    expect(args[descIdx + 1]).toBe("");
    expect(args).toContain("--yes");
  });

  it("reads the description from --description-file", async () => {
    const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "glab-axi-mr-"));
    try {
      const file = join(dir, "body.md");
      writeFileSync(file, "# Body from file", "utf8");
      mockedGlabExec.mockResolvedValueOnce(
        "https://gitlab.com/group/project/-/merge_requests/42",
      );
      mockedGlabJson.mockResolvedValueOnce({ ...OPEN_MR });
      await mrCommand(
        ["create", "--title", "Fix login", "--description-file", file],
        ctx,
      );
      const args = mockedGlabExec.mock.calls[0]?.[0] as string[];
      const descIdx = args.indexOf("--description");
      expect(args[descIdx + 1]).toBe("# Body from file");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("forwards branch, assignee, label, and milestone flags", async () => {
    mockedGlabExec.mockResolvedValueOnce(
      "https://gitlab.com/group/project/-/merge_requests/42",
    );
    mockedGlabJson.mockResolvedValueOnce({ ...OPEN_MR });
    await mrCommand(
      [
        "create",
        "--title", "Fix login",
        "--source-branch", "fix-login",
        "--target-branch", "main",
        "--assignee", "alice",
        "--assignee", "carol",
        "--label", "bug",
        "--milestone", "7",
      ],
      ctx,
    );
    expect(mockedGlabExec).toHaveBeenCalledWith(
      [
        "mr", "create",
        "--title", "Fix login",
        "--description", "",
        "--yes",
        "--source-branch", "fix-login",
        "--target-branch", "main",
        "--assignee", "alice",
        "--assignee", "carol",
        "--label", "bug",
        "--milestone", "7",
      ],
      ctx,
    );
  });

  it("refuses a blank --source-branch instead of opening from the current branch", async () => {
    await expect(
      mrCommand(["create", "--title", "Fix login", "--source-branch", ""], ctx),
    ).rejects.toThrow(/--source-branch requires a value/);
    expect(mockedGlabExec).not.toHaveBeenCalled();
  });

  it("raises MutationFollowupError when the read-back fails", async () => {
    mockedGlabExec.mockResolvedValueOnce(
      "https://gitlab.com/group/project/-/merge_requests/42",
    );
    mockedGlabJson.mockRejectedValueOnce(
      new AxiError("view blew up", "NOT_FOUND"),
    );
    await expect(
      mrCommand(["create", "--title", "Fix login"], ctx),
    ).rejects.toBeInstanceOf(MutationFollowupError);
  });
});

describe("mr merge", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("is a no-op when the MR is already merged (exact state match)", async () => {
    mockedGlabJson.mockResolvedValueOnce(mergedMr());
    const result = await mrCommand(["merge", "42"], ctx);
    expect(mockedGlabExec).not.toHaveBeenCalled();
    expect(result).toContain("state: merged");
    expect(result).toContain("merged_by: bob");
    expect(result).toContain("message: Already merged");
  });

  it("merges immediately by default (--auto-merge=false, --yes)", async () => {
    mockedGlabJson.mockResolvedValueOnce({ ...OPEN_MR });
    await mrCommand(["merge", "42"], ctx);
    expect(mockedGlabExec).toHaveBeenCalledWith(
      ["mr", "merge", "42", "--yes", "--auto-merge=false"],
      ctx,
    );
  });

  it("--auto waits for the pipeline instead", async () => {
    mockedGlabJson.mockResolvedValueOnce({ ...OPEN_MR });
    await mrCommand(["merge", "42", "--auto"], ctx);
    const args = mockedGlabExec.mock.calls[0]?.[0] as string[];
    expect(args).toContain("--auto-merge=true");
    expect(args).not.toContain("--auto-merge=false");
  });

  it("forwards the squash method", async () => {
    mockedGlabJson.mockResolvedValueOnce({ ...OPEN_MR });
    await mrCommand(["merge", "42", "--squash"], ctx);
    const args = mockedGlabExec.mock.calls[0]?.[0] as string[];
    expect(args).toContain("--squash");
    expect(args).not.toContain("--rebase");
  });

  it("forwards the rebase method", async () => {
    mockedGlabJson.mockResolvedValueOnce({ ...OPEN_MR });
    await mrCommand(["merge", "42", "--rebase"], ctx);
    const args = mockedGlabExec.mock.calls[0]?.[0] as string[];
    expect(args).toContain("--rebase");
    expect(args).not.toContain("--squash");
  });

  it("rejects two merge methods", async () => {
    mockedGlabJson.mockResolvedValueOnce({ ...OPEN_MR });
    await expect(
      mrCommand(["merge", "42", "--squash", "--rebase"], ctx),
    ).rejects.toThrow(/Choose only one merge method/);
  });

  it("rejects the strategy spellings glab mr merge does not have", async () => {
    for (const flag of ["--merge", "--method"]) {
      await expect(
        mrCommand(["merge", "42", flag], ctx),
      ).rejects.toThrow(new RegExp(`unknown flag.*\\${flag}`));
    }
    expect(mockedGlabExec).not.toHaveBeenCalled();
  });

  it("reports method: default when no strategy flag is given", async () => {
    mockedGlabJson.mockResolvedValueOnce({ ...OPEN_MR });
    const result = await mrCommand(["merge", "42"], ctx);
    const args = mockedGlabExec.mock.calls[0]?.[0] as string[];
    expect(args).not.toContain("--squash");
    expect(args).not.toContain("--rebase");
    expect(result).toContain("method: default");
  });

  it("rejects valued boolean switches before any glab call", async () => {
    await expect(
      mrCommand(["merge", "42", "--squash=false"], ctx),
    ).rejects.toThrow(/--squash=false/);
    await expect(
      mrCommand(["merge", "42", "--auto=true"], ctx),
    ).rejects.toThrow(/--auto=true/);
    expect(mockedGlabJson).not.toHaveBeenCalled();
    expect(mockedGlabExec).not.toHaveBeenCalled();
  });

  it("proceeds when the state cannot be read (degrades, never false-positives)", async () => {
    mockedGlabJson.mockResolvedValueOnce({ iid: 42, title: "Fix login" });
    await mrCommand(["merge", "42"], ctx);
    expect(mockedGlabExec).toHaveBeenCalled();
    const args = mockedGlabExec.mock.calls[0]?.[0] as string[];
    expect(args[0]).toBe("mr");
    expect(args[1]).toBe("merge");
  });

  it("forwards --remove-source-branch, --message, and --sha", async () => {
    mockedGlabJson.mockResolvedValueOnce({ ...OPEN_MR });
    await mrCommand(
      ["merge", "42", "--remove-source-branch", "--message", "Merge!", "--sha", "abc123"],
      ctx,
    );
    const args = mockedGlabExec.mock.calls[0]?.[0] as string[];
    expect(args).toContain("--remove-source-branch");
    expect(args).toContain("--message");
    expect(args[args.indexOf("--message") + 1]).toBe("Merge!");
    expect(args).toContain("--sha");
    expect(args[args.indexOf("--sha") + 1]).toBe("abc123");
  });

  it("refuses a blank or value-less --sha instead of merging without it", async () => {
    await expect(mrCommand(["merge", "42", "--sha", ""], ctx)).rejects.toThrow(
      /--sha requires a value/,
    );
    await expect(mrCommand(["merge", "42", "--sha"], ctx)).rejects.toThrow(
      /--sha requires a value/,
    );
    expect(mockedGlabExec).not.toHaveBeenCalled();
  });

  it("takes the MR number from the positional, not an all-digit flag value", async () => {
    mockedGlabJson.mockResolvedValueOnce({ ...OPEN_MR });
    await mrCommand(["merge", "--sha", "1234567", "42"], ctx);
    expect(mockedGlabJson).toHaveBeenCalledWith(
      ["mr", "view", "42", "-F", "json"],
      ctx,
    );
    const args = mockedGlabExec.mock.calls[0]?.[0] as string[];
    expect(args.slice(0, 3)).toEqual(["mr", "merge", "42"]);
    expect(args[args.indexOf("--sha") + 1]).toBe("1234567");
  });

  it("renders the merged confirmation block", async () => {
    mockedGlabJson.mockResolvedValueOnce({ ...OPEN_MR });
    const result = await mrCommand(["merge", "42", "--squash"], ctx);
    expect(result).toContain("merged:");
    expect(result).toContain("iid: 42");
    expect(result).toContain("status: ok");
    expect(result).toContain("method: squash");
    expect(result).toContain("auto: no");
  });
});

describe("mr close", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("is a no-op when already closed (exact state match)", async () => {
    mockedGlabJson.mockResolvedValueOnce({ ...OPEN_MR, state: "closed" });
    const result = await mrCommand(["close", "42"], ctx);
    expect(mockedGlabExec).not.toHaveBeenCalled();
    expect(result).toContain("message: Already closed");
    expect(result).toContain("state: closed");
  });

  it("refuses to close a merged MR", async () => {
    mockedGlabJson.mockResolvedValueOnce(mergedMr());
    await expect(mrCommand(["close", "42"], ctx)).rejects.toThrow(
      /already merged; nothing to close/,
    );
    expect(mockedGlabExec).not.toHaveBeenCalled();
  });

  it("closes an opened MR and reads back the state", async () => {
    mockedGlabJson
      .mockResolvedValueOnce({ ...OPEN_MR })
      .mockResolvedValueOnce({ ...OPEN_MR, state: "closed" });
    const result = await mrCommand(["close", "42"], ctx);
    expect(mockedGlabExec).toHaveBeenCalledWith(["mr", "close", "42"], ctx);
    expect(result).toContain("state: closed");
  });

  it("proceeds when the state cannot be read", async () => {
    mockedGlabJson
      .mockResolvedValueOnce({ iid: 42 })
      .mockResolvedValueOnce({ ...OPEN_MR, state: "closed" });
    await mrCommand(["close", "42"], ctx);
    expect(mockedGlabExec).toHaveBeenCalledWith(["mr", "close", "42"], ctx);
  });
});

describe("mr reopen", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("is a no-op when already opened (exact state match)", async () => {
    mockedGlabJson.mockResolvedValueOnce({ ...OPEN_MR });
    const result = await mrCommand(["reopen", "42"], ctx);
    expect(mockedGlabExec).not.toHaveBeenCalled();
    expect(result).toContain("message: Already opened");
  });

  it("refuses to reopen a merged MR", async () => {
    mockedGlabJson.mockResolvedValueOnce(mergedMr());
    await expect(mrCommand(["reopen", "42"], ctx)).rejects.toThrow(
      /merged and cannot be reopened/,
    );
    expect(mockedGlabExec).not.toHaveBeenCalled();
  });

  it("reopens a closed MR and reads back the state", async () => {
    mockedGlabJson
      .mockResolvedValueOnce({ ...OPEN_MR, state: "closed" })
      .mockResolvedValueOnce({ ...OPEN_MR });
    const result = await mrCommand(["reopen", "42"], ctx);
    expect(mockedGlabExec).toHaveBeenCalledWith(["mr", "reopen", "42"], ctx);
    expect(result).toContain("state: opened");
  });
});

describe("MR_FLAGS covers the documented interface", () => {
  it("declares flags for every documented subcommand", () => {
    expect(Object.keys(MR_FLAGS).sort()).toEqual([
      "close", "create", "list", "merge", "reopen", "view",
    ]);
  });
});
