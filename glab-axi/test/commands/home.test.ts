import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/glab.js", () => ({
  glabJson: vi.fn(),
  glabExec: vi.fn(),
  glabRaw: vi.fn(),
}));

import { glabJson } from "../../src/glab.js";
import { homeCommand } from "../../src/commands/home.js";
import type { ProjectContext } from "../../src/context.js";

const mockedGlabJson = vi.mocked(glabJson);

const ctx: ProjectContext = { fullPath: "group/project", source: "flag" };

describe("homeCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("fetches three recent issues (-O json) and MRs (-F json) in parallel", async () => {
    mockedGlabJson.mockResolvedValue([]);
    await homeCommand([], ctx);
    const calls = mockedGlabJson.mock.calls.map((c) => c[0]);
    expect(calls).toContainEqual(["issue", "list", "-O", "json", "--per-page", "3"]);
    expect(calls).toContainEqual(["mr", "list", "-F", "json", "--per-page", "3"]);
  });

  it("renders the project path and TOON lists", async () => {
    mockedGlabJson.mockImplementation((args: string[]) => {
      if (args[0] === "issue") {
        return Promise.resolve([
          { iid: 1, title: "Bug", state: "opened", author: { username: "a" } },
        ]);
      }
      return Promise.resolve([
        {
          iid: 2,
          title: "Fix",
          state: "opened",
          author: { username: "b" },
          source_branch: "fix",
        },
      ]);
    });
    const result = await homeCommand([], ctx);
    expect(result).toContain("project: group/project");
    expect(result).toContain("issues[1]{iid,title,state,author}:");
    expect(result).toContain("1,Bug,opened,a");
    expect(result).toContain("mrs[1]{iid,title,author,state,branch}:");
    expect(result).toContain("2,Fix,b,opened,fix");
  });

  it("falls back to empty-state lines when a query fails", async () => {
    mockedGlabJson.mockRejectedValue(new Error("no auth"));
    const result = await homeCommand([], ctx);
    expect(result).toContain("issues: 0 opened");
    expect(result).toContain("mrs: 0 opened");
  });

  it("hints at full lists when a query fills its page", async () => {
    mockedGlabJson.mockResolvedValue([
      { iid: 1, title: "T", state: "opened", author: { username: "a" } },
      { iid: 2, title: "T", state: "opened", author: { username: "a" } },
      { iid: 3, title: "T", state: "opened", author: { username: "a" } },
    ]);
    const result = await homeCommand([], ctx);
    expect(result).toContain("Run `glab-axi issue list` for full issue list");
    expect(result).toContain("Run `glab-axi mr list` for full MR list");
  });

  it("omits the project line without context", async () => {
    mockedGlabJson.mockResolvedValue([]);
    const result = await homeCommand([]);
    expect(result).not.toContain("project:");
  });
});
