import { describe, it, expect } from "vitest";
import { resolveUrlTargets } from "../src/cli.js";

describe("resolveUrlTargets", () => {
  it("replaces a PR URL with its number and takes the repo from it", () => {
    const args = ["view", "https://github.com/cli/cli/pull/1"];
    expect(resolveUrlTargets("pr", args, undefined)).toBe("cli/cli");
    expect(args).toEqual(["view", "1"]);
  });

  it("accepts URLs with a trailing path, query or fragment", () => {
    const args = ["diff", "https://github.com/cli/cli/pull/7/files?w=1#x"];
    expect(resolveUrlTargets("pr", args, undefined)).toBe("cli/cli");
    expect(args).toEqual(["diff", "7"]);
  });

  it("accepts issue URLs on issue subcommands only", () => {
    const issueArgs = ["view", "https://github.com/cli/cli/issues/3"];
    expect(resolveUrlTargets("issue", issueArgs, undefined)).toBe("cli/cli");
    expect(issueArgs).toEqual(["view", "3"]);

    const prArgs = ["view", "https://github.com/cli/cli/issues/3"];
    expect(resolveUrlTargets("pr", prArgs, undefined)).toBeUndefined();
    expect(prArgs).toEqual(["view", "https://github.com/cli/cli/issues/3"]);
  });

  it("keeps a matching explicit repo, ignoring case", () => {
    const args = ["view", "https://github.com/CLI/cli/pull/1"];
    expect(resolveUrlTargets("pr", args, "cli/CLI")).toBe("cli/CLI");
    expect(args).toEqual(["view", "1"]);
  });

  it("rejects a URL that conflicts with an explicit repo", () => {
    const args = ["view", "https://github.com/cli/cli/pull/1"];
    expect(() => resolveUrlTargets("pr", args, "octo/other")).toThrow(
      /conflicts with the repository octo\/other/,
    );
  });

  it("rejects two URLs from different repos", () => {
    const args = [
      "comment",
      "https://github.com/a/b/pull/1",
      "https://github.com/c/d/pull/2",
    ];
    expect(() => resolveUrlTargets("pr", args, undefined)).toThrow(
      /conflicts with the repository a\/b/,
    );
  });

  it("leaves a URL given as a flag value alone", () => {
    const args = [
      "comment",
      "1",
      "--body",
      "https://github.com/cli/cli/pull/9",
    ];
    expect(resolveUrlTargets("pr", args, undefined)).toBeUndefined();
    expect(args).toEqual([
      "comment",
      "1",
      "--body",
      "https://github.com/cli/cli/pull/9",
    ]);
  });

  it("does nothing for other commands and plain numbers", () => {
    const args = ["view", "https://github.com/cli/cli/pull/1"];
    expect(resolveUrlTargets("repo", args, undefined)).toBeUndefined();
    expect(args).toEqual(["view", "https://github.com/cli/cli/pull/1"]);

    const numeric = ["view", "12"];
    expect(resolveUrlTargets("pr", numeric, "a/b")).toBe("a/b");
    expect(numeric).toEqual(["view", "12"]);
  });
});
