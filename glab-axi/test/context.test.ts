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

  it("normalizes a URL flag value to its path", () => {
    expect(resolveProject("https://git.example.com/group/sub/project")).toEqual(
      { fullPath: "group/sub/project", source: "flag" },
    );
  });

  it("strips .git from a URL flag value", () => {
    expect(resolveProject("https://gitlab.com/group/project.git")).toEqual({
      fullPath: "group/project",
      source: "flag",
    });
  });

  it("rejects a flag value without a path", () => {
    expect(resolveProject("")).toBeUndefined();
    expect(resolveProject("has space/x")).toBeUndefined();
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
