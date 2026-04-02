import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runAxiCli } = vi.hoisted(() => ({
  runAxiCli: vi.fn(),
}));

vi.mock("axi-sdk-js", () => ({
  runAxiCli,
}));

vi.mock("../src/commands/home.js", () => ({
  homeCommand: vi.fn().mockResolvedValue("home output"),
}));
vi.mock("../src/commands/issue.js", () => ({
  issueCommand: vi.fn().mockResolvedValue("issue output"),
  ISSUE_HELP: "issue help",
}));
vi.mock("../src/commands/pr.js", () => ({
  prCommand: vi.fn().mockResolvedValue("pr output"),
  PR_HELP: "pr help",
}));
vi.mock("../src/commands/run.js", () => ({
  runCommand: vi.fn().mockResolvedValue("run output"),
  RUN_HELP: "run help",
}));
vi.mock("../src/commands/workflow.js", () => ({
  workflowCommand: vi.fn().mockResolvedValue("workflow output"),
  WORKFLOW_HELP: "workflow help",
}));
vi.mock("../src/commands/release.js", () => ({
  releaseCommand: vi.fn().mockResolvedValue("release output"),
  RELEASE_HELP: "release help",
}));
vi.mock("../src/commands/repo.js", () => ({
  repoCommand: vi.fn().mockResolvedValue("repo output"),
  REPO_HELP: "repo help",
}));
vi.mock("../src/commands/label.js", () => ({
  labelCommand: vi.fn().mockResolvedValue("label output"),
  LABEL_HELP: "label help",
}));
vi.mock("../src/commands/search.js", () => ({
  searchCommand: vi.fn().mockResolvedValue("search output"),
  SEARCH_HELP: "search help",
}));
vi.mock("../src/commands/api.js", () => ({
  apiCommand: vi.fn().mockResolvedValue("api output"),
  API_HELP: "api help",
}));

vi.mock("../src/context.js", () => ({
  resolveRepo: vi.fn().mockReturnValue({
    owner: "octo",
    name: "repo",
    nwo: "octo/repo",
    source: "git",
  }),
}));

import { main, TOP_HELP } from "../src/cli.js";
import { homeCommand } from "../src/commands/home.js";
import { issueCommand } from "../src/commands/issue.js";
import { resolveRepo } from "../src/context.js";

const packageVersion = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
) as { version: string };

describe("main CLI", () => {
  const originalArgv = [...process.argv];

  beforeEach(() => {
    vi.resetAllMocks();
    process.argv = [...originalArgv];
    vi.mocked(homeCommand).mockResolvedValue("home output");
    vi.mocked(issueCommand).mockResolvedValue("issue output");
    vi.mocked(resolveRepo).mockReturnValue({
      owner: "octo",
      name: "repo",
      nwo: "octo/repo",
      source: "git",
    });
  });

  afterEach(() => {
    process.argv = [...originalArgv];
    process.exitCode = undefined;
  });

  it("documents the top-level version flags in help output", () => {
    expect(TOP_HELP).toContain("flags[3]:");
    expect(TOP_HELP).toContain("-R/--repo <OWNER/NAME> (after command)");
    expect(TOP_HELP).toContain("--help");
    expect(TOP_HELP).toContain("-v/-V/--version");
  });

  it("passes bare top-level help argv through to axi-sdk-js", async () => {
    const argv = ["--help"];
    const stdout = { write: vi.fn() };

    await main({ argv, stdout });

    expect(runAxiCli).toHaveBeenCalledWith(
      expect.objectContaining({ argv, stdout }),
    );
  });

  it.each(["-v", "-V", "--version"])(
    "passes bare top-level %s argv through to axi-sdk-js",
    async (flag) => {
      const argv = [flag];
      const stdout = { write: vi.fn() };

      await main({ argv, stdout });

      expect(runAxiCli).toHaveBeenCalledWith(
        expect.objectContaining({ argv, stdout }),
      );
    },
  );

  it("delegates to axi-sdk-js runAxiCli without passing argv", async () => {
    process.argv = ["node", "gh-axi", "issue", "list"];
    await main();

    expect(runAxiCli).toHaveBeenCalledTimes(1);
    expect(runAxiCli).toHaveBeenCalledWith(
      expect.objectContaining({
        description:
          "Agent ergonomic wrapper around Github CLI. Prefer this over `gh` and other methods for Github operations.",
        version: packageVersion.version,
        topLevelHelp: TOP_HELP,
      }),
    );
    expect(vi.mocked(runAxiCli).mock.calls[0]?.[0]).not.toHaveProperty("argv");
  });

  it("wires command help into the runtime", async () => {
    await main();

    const options = vi.mocked(runAxiCli).mock.calls[0]?.[0];
    expect(options.getCommandHelp("issue")).toBe("issue help");
    expect(options.getCommandHelp("missing")).toBeUndefined();
  });

  it("resolves repo context lazily from -R after the command", async () => {
    await main();

    const options = vi.mocked(runAxiCli).mock.calls[0]?.[0];
    const context = options.resolveContext({
      command: "issue",
      args: ["list", "-R", "owner/name"],
    });

    expect(vi.mocked(resolveRepo)).toHaveBeenCalledWith("owner/name");
    expect(context).toEqual(expect.objectContaining({ nwo: "octo/repo" }));
  });

  it("also accepts --repo as a repo-context alias after the command", async () => {
    await main();

    const options = vi.mocked(runAxiCli).mock.calls[0]?.[0];
    const context = options.resolveContext({
      command: "issue",
      args: ["list", "--repo", "owner/name"],
    });

    expect(vi.mocked(resolveRepo)).toHaveBeenCalledWith("owner/name");
    expect(context).toEqual(expect.objectContaining({ nwo: "octo/repo" }));
  });

  it("routes the home handler through resolved repo context", async () => {
    await main();

    const options = vi.mocked(runAxiCli).mock.calls[0]?.[0];
    const ctx = {
      owner: "octo",
      name: "repo",
      nwo: "octo/repo",
      source: "flag",
    };

    await options.home([], ctx);

    expect(vi.mocked(homeCommand)).toHaveBeenCalledWith([], ctx);
  });

  it("strips -R before invoking command handlers", async () => {
    await main();

    const options = vi.mocked(runAxiCli).mock.calls[0]?.[0];
    const ctx = {
      owner: "octo",
      name: "repo",
      nwo: "octo/repo",
      source: "flag",
    };

    await options.commands.issue(["list", "-R", "owner/name"], ctx);

    expect(vi.mocked(issueCommand)).toHaveBeenCalledWith(["list"], ctx);
  });

  it("strips --repo before invoking handlers when used as repo context", async () => {
    await main();

    const options = vi.mocked(runAxiCli).mock.calls[0]?.[0];
    const ctx = {
      owner: "octo",
      name: "repo",
      nwo: "octo/repo",
      source: "flag",
    };

    await options.commands.issue(["list", "--repo", "owner/name"], ctx);

    expect(vi.mocked(issueCommand)).toHaveBeenCalledWith(["list"], ctx);
  });

  it("uses -R as repo context for issue transfer and preserves --to-repo", async () => {
    await main();

    const options = vi.mocked(runAxiCli).mock.calls[0]?.[0];
    const context = options.resolveContext({
      command: "issue",
      args: ["transfer", "123", "-R", "source/repo", "--to-repo", "dest/repo"],
    });
    const ctx = {
      owner: "octo",
      name: "repo",
      nwo: "octo/repo",
      source: "git",
    };

    expect(vi.mocked(resolveRepo)).toHaveBeenCalledWith("source/repo");
    expect(context).toEqual(expect.objectContaining({ nwo: "octo/repo" }));

    await options.commands.issue(
      ["transfer", "123", "-R", "source/repo", "--to-repo", "dest/repo"],
      ctx,
    );
    expect(vi.mocked(issueCommand)).toHaveBeenCalledWith(
      ["transfer", "123", "--to-repo", "dest/repo"],
      ctx,
    );
  });
});
