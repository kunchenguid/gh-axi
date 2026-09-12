import { describe, it, expect, beforeEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { resolveProject } from "../src/context.js";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(execFileSync);

function mockGitRemote(url: string | null): void {
  if (url === null) {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error("no remote");
    });
    return;
  }
  mockedExecFileSync.mockImplementation(() => url);
}

describe("resolveProject", () => {
  beforeEach(() => {
    delete process.env["GITLAB_REPO"];
    mockedExecFileSync.mockReset();
    mockGitRemote(null);
  });

  it("uses an explicit flag value", () => {
    expect(resolveProject("group/project")).toEqual({
      fullPath: "group/project",
      source: "flag",
    });
  });

  it("keeps the host a URL flag value names", () => {
    expect(resolveProject("https://git.example.com/group/sub/project")).toEqual(
      { fullPath: "git.example.com/group/sub/project", source: "flag" },
    );
  });

  it("keeps a self-hosted URL off the default host", () => {
    // glab reads -R as [HOST/]OWNER/[NAMESPACE/]REPO, so the host must survive.
    const project = resolveProject("https://gitlab.corp.com/team/app");
    expect(project?.fullPath).toBe("gitlab.corp.com/team/app");
    expect(project?.fullPath.startsWith("gitlab.corp.com/")).toBe(true);
  });

  it("passes a bare HOST/PATH selector through unchanged", () => {
    expect(resolveProject("gitlab.corp.com/team/app")?.fullPath).toBe(
      "gitlab.corp.com/team/app",
    );
  });

  it("strips .git from a URL flag value", () => {
    expect(resolveProject("https://gitlab.com/group/project.git")).toEqual({
      fullPath: "gitlab.com/group/project",
      source: "flag",
    });
  });

  it("refuses an explicit selector it cannot parse, never falling back", () => {
    expect(() => resolveProject("")).toThrow(/Invalid -R\/--repo project/);
    expect(() => resolveProject("has space/x")).toThrow(
      /Invalid -R\/--repo project/,
    );
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it("refuses an unparseable GITLAB_REPO by name", () => {
    process.env["GITLAB_REPO"] = "my group/b";
    expect(() => resolveProject()).toThrow(/Invalid GITLAB_REPO project/);
    delete process.env["GITLAB_REPO"];
  });

  it("prefers the flag over GITLAB_REPO", () => {
    process.env["GITLAB_REPO"] = "env/group/project";
    expect(resolveProject("flag/project")?.fullPath).toBe("flag/project");
    delete process.env["GITLAB_REPO"];
  });

  it("uses GITLAB_REPO when no flag is given", () => {
    process.env["GITLAB_REPO"] = "env/group/project";
    expect(resolveProject()).toEqual({
      fullPath: "env/group/project",
      source: "env",
    });
    delete process.env["GITLAB_REPO"];
  });

  it("parses an HTTPS git remote with nested groups", () => {
    mockGitRemote("https://gitlab.com/group/sub/project.git");
    expect(resolveProject()).toEqual({
      fullPath: "group/sub/project",
      source: "git",
    });
  });

  it("parses an SSH git remote", () => {
    mockGitRemote("git@gitlab.com:group/project.git");
    expect(resolveProject()).toEqual({
      fullPath: "group/project",
      source: "git",
    });
  });

  it("ignores a non-default port in an SSH remote", () => {
    process.env["GITLAB_HOST"] = "git.example.com";
    mockGitRemote("ssh://git@git.example.com:2222/group/sub/project.git");
    expect(resolveProject()).toEqual({
      fullPath: "group/sub/project",
      source: "git",
    });
    delete process.env["GITLAB_HOST"];
  });

  it("ignores a non-default port in an HTTPS remote", () => {
    process.env["GITLAB_HOST"] = "git.example.com";
    mockGitRemote("https://git.example.com:8443/group/project.git");
    expect(resolveProject()).toEqual({
      fullPath: "group/project",
      source: "git",
    });
    delete process.env["GITLAB_HOST"];
  });

  it("matches a self-hosted host from GITLAB_HOST", () => {
    process.env["GITLAB_HOST"] = "git.example.com";
    mockGitRemote("git@git.example.com:group/project.git");
    expect(resolveProject()).toEqual({
      fullPath: "group/project",
      source: "git",
    });
    delete process.env["GITLAB_HOST"];
  });

  it("ignores remotes pointing at another host", () => {
    mockGitRemote("git@github.com:owner/name.git");
    expect(resolveProject()).toBeUndefined();
  });

  it("returns undefined outside a git checkout with no env", () => {
    expect(resolveProject()).toBeUndefined();
  });
});
