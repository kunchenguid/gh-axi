import { describe, it, expect } from "vitest";
import { getSuggestions, withSuggestionHost } from "../src/suggestions.js";
import type { ProjectContext } from "../src/context.js";
import type { HostContext } from "../src/host.js";

const gitRepo: ProjectContext = { fullPath: "group/project", source: "git" };
const flagRepo: ProjectContext = { fullPath: "group/project", source: "flag" };
const flagHost: HostContext = { value: "git.example.com" };

describe("getSuggestions", () => {
  it("appends -R for flag/env project sources", () => {
    const lines = getSuggestions({
      domain: "mr",
      action: "list",
      repo: flagRepo,
    });
    expect(lines.join("\n")).toContain("`glab-axi mr view <number> -R group/project`");
  });

  it("omits -R for git-checkout sources", () => {
    const lines = getSuggestions({
      domain: "mr",
      action: "list",
      repo: gitRepo,
    });
    expect(lines.join("\n")).not.toContain("-R");
  });

  it("reorders a leading -R in a suggested command to command-first", () => {
    const lines = getSuggestions({
      domain: "issue",
      action: "close",
      id: 4,
      repo: flagRepo,
    });
    // The raw table line starts with the repo flag; normalization must move
    // -R after the command.
    for (const line of lines) {
      expect(line).toMatch(/`glab-axi issue list -R group\/project`/);
    }
  });

  it("appends --hostname to every suggested command for a flag host", async () => {
    await withSuggestionHost(flagHost, async () => {
      const lines = getSuggestions({
        domain: "mr",
        action: "merge",
        id: 9,
        repo: gitRepo,
      });
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).toContain("--hostname git.example.com");
      }
    });
  });

  it("keeps an explicit gitlab.com host free of --hostname", async () => {
    await withSuggestionHost({ value: "gitlab.com" }, async () => {
      const lines = getSuggestions({
        domain: "mr",
        action: "merge",
        id: 9,
        repo: gitRepo,
      });
      expect(lines.join("\n")).not.toContain("--hostname");
    });
  });

  it("keeps default-host suggestions free of --hostname", () => {
    const lines = getSuggestions({
      domain: "mr",
      action: "merge",
      id: 9,
      repo: gitRepo,
    });
    expect(lines.join("\n")).not.toContain("--hostname");
  });

  it("suggests view and create after a non-empty mr list", () => {
    const lines = getSuggestions({
      domain: "mr",
      action: "list",
      isEmpty: false,
      repo: gitRepo,
    });
    expect(lines.join("\n")).toContain("mr view <number>");
    expect(lines.join("\n")).toContain("mr create --title");
  });

  it("suggests create and merged-state list after an empty mr list", () => {
    const lines = getSuggestions({
      domain: "mr",
      action: "list",
      isEmpty: true,
      repo: gitRepo,
    });
    const joined = lines.join("\n");
    expect(joined).toContain("mr create --title");
    expect(joined).toContain("--state merged");
  });

  it("suggests merge for an opened MR view", () => {
    const lines = getSuggestions({
      domain: "mr",
      action: "view",
      state: "opened",
      id: 5,
      repo: gitRepo,
    });
    expect(lines.join("\n")).toContain("mr merge 5");
  });

  it("suggests reopen for a closed MR view", () => {
    const lines = getSuggestions({
      domain: "mr",
      action: "view",
      state: "closed",
      id: 5,
      repo: gitRepo,
    });
    expect(lines.join("\n")).toContain("mr reopen 5");
  });

  it("stays silent for a merged MR view", () => {
    const lines = getSuggestions({
      domain: "mr",
      action: "view",
      state: "merged",
      id: 5,
      repo: gitRepo,
    });
    expect(lines).toEqual([]);
  });

  it("suggests close for an opened issue view", () => {
    const lines = getSuggestions({
      domain: "issue",
      action: "view",
      state: "opened",
      id: 8,
      repo: gitRepo,
    });
    expect(lines.join("\n")).toContain("issue close 8");
  });

  it("points at issue and mr lists from repo view", () => {
    const lines = getSuggestions({ domain: "repo", action: "view", repo: gitRepo });
    const joined = lines.join("\n");
    expect(joined).toContain("issue list");
    expect(joined).toContain("mr list");
  });

  it("names the command list from home", () => {
    const lines = getSuggestions({ domain: "home", action: "home" });
    expect(lines[0]).toContain("mr, issue, repo, api");
  });
});
