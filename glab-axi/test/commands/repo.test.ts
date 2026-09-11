import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/glab.js", () => ({
  glabJson: vi.fn(),
  glabExec: vi.fn(),
}));

import { glabJson } from "../../src/glab.js";
import { repoCommand, REPO_HELP } from "../../src/commands/repo.js";
import type { ProjectContext } from "../../src/context.js";

const mockedGlabJson = vi.mocked(glabJson);

const ctx: ProjectContext = { fullPath: "group/project", source: "flag" };

const PROJECT = {
  name_with_namespace: "Group / Project",
  path_with_namespace: "group/project",
  description: "A project",
  default_branch: "main",
  star_count: 5,
  forks_count: 2,
  open_issues_count: 7,
  visibility: "private",
  web_url: "https://gitlab.com/group/project",
};

describe("repoCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns help for --help/-h/no subcommand", async () => {
    expect(await repoCommand(["--help"])).toContain(REPO_HELP);
    expect(await repoCommand(["-h"])).toContain(REPO_HELP);
    expect(await repoCommand([])).toContain(REPO_HELP);
  });

  it("returns an error block for unknown subcommands", async () => {
    const result = await repoCommand(["create", "x"]);
    expect(result).toContain("Unknown repo subcommand: create");
    expect(result).toContain("Available subcommands: view");
  });

  it("views the current project with -F json and renders a compact schema", async () => {
    mockedGlabJson.mockResolvedValueOnce({ ...PROJECT });
    const result = await repoCommand(["view"], ctx);
    expect(mockedGlabJson).toHaveBeenCalledWith(
      ["repo", "view", "-F", "json"],
      ctx,
    );
    expect(result).toContain("project:");
    expect(result).toContain("name: Group / Project");
    expect(result).toContain("branch: main");
    expect(result).toContain("stars: 5");
    expect(result).toContain("issues: 7");
    expect(result).toContain("visibility: private");
  });

  it("accepts a positional project path with nested groups", async () => {
    mockedGlabJson.mockResolvedValueOnce({ ...PROJECT });
    await repoCommand(["view", "group/sub/project"]);
    expect(mockedGlabJson).toHaveBeenCalledWith(
      ["repo", "view", "-F", "json", "group/sub/project"],
      undefined,
    );
  });

  it("rejects a positional combined with a --repo flag", async () => {
    await expect(
      repoCommand(["view", "other/project"], ctx),
    ).rejects.toThrow(/Unsupported positional argument for repo view with --repo/);
  });

  it("rejects a positional combined with a GITLAB_REPO selector", async () => {
    const envCtx: ProjectContext = { fullPath: "group/project", source: "env" };
    await expect(
      repoCommand(["view", "other/project"], envCtx),
    ).rejects.toThrow(
      /Unsupported positional argument for repo view with GITLAB_REPO/,
    );
    expect(mockedGlabJson).not.toHaveBeenCalled();
  });

  it("suggests the project's issue and MR lists", async () => {
    mockedGlabJson.mockResolvedValueOnce({ ...PROJECT });
    const result = await repoCommand(["view"], ctx);
    expect(result).toContain("help[2]:");
    expect(result).toContain("glab-axi issue list -R group/project");
    expect(result).toContain("glab-axi mr list -R group/project");
  });

  it("rejects extra positionals", async () => {
    await expect(
      repoCommand(["view", "a/b", "c/d"]),
    ).rejects.toThrow(/Unsupported positional argument for repo view: c\/d/);
  });
});
