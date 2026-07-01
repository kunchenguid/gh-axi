import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { installSessionStartHooks, runAxiCli } = vi.hoisted(() => ({
  installSessionStartHooks: vi.fn(),
  runAxiCli: vi.fn(),
}));

vi.mock("axi-sdk-js", async () => {
  const actual =
    await vi.importActual<typeof import("axi-sdk-js")>("axi-sdk-js");
  return {
    ...actual,
    installSessionStartHooks,
    runAxiCli,
  };
});

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
vi.mock("../src/commands/secret.js", () => ({
  secretCommand: vi.fn().mockResolvedValue("secret output"),
  SECRET_HELP: "secret help",
}));
vi.mock("../src/commands/variable.js", () => ({
  variableCommand: vi.fn().mockResolvedValue("variable output"),
  VARIABLE_HELP: "variable help",
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
import { releaseCommand } from "../src/commands/release.js";
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
    vi.mocked(releaseCommand).mockResolvedValue("release output");
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

  it("documents explicit hook setup in help output", () => {
    expect(TOP_HELP).toContain("setup");
    expect(TOP_HELP).toContain("gh-axi setup hooks");
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

  it("does not pass the removed hooks option to axi-sdk-js", async () => {
    const originalDisableHooks = process.env.GH_AXI_DISABLE_HOOKS;
    process.env.GH_AXI_DISABLE_HOOKS = "1";

    try {
      await main();
    } finally {
      if (originalDisableHooks === undefined) {
        delete process.env.GH_AXI_DISABLE_HOOKS;
      } else {
        process.env.GH_AXI_DISABLE_HOOKS = originalDisableHooks;
      }
    }

    expect(vi.mocked(runAxiCli).mock.calls[0]?.[0]).not.toHaveProperty("hooks");
  });

  it("installs session hooks from the explicit setup command", async () => {
    await main();

    const options = vi.mocked(runAxiCli).mock.calls[0]?.[0];
    const output = await options.commands.setup(["hooks"]);

    expect(installSessionStartHooks).toHaveBeenCalledTimes(1);
    expect(installSessionStartHooks).toHaveBeenCalledWith();
    expect(output).toContain("hooks:");
    expect(output).toContain("status: installed");
    expect(output).toContain("Restart your agent session");
  });

  it("wires command help into the runtime", async () => {
    await main();

    const options = vi.mocked(runAxiCli).mock.calls[0]?.[0];
    expect(options.getCommandHelp("issue")).toBe("issue help");
    expect(options.getCommandHelp("secret")).toBe("secret help");
    expect(options.getCommandHelp("variable")).toBe("variable help");
    expect(options.getCommandHelp("missing")).toBeUndefined();
  });

  it("lists secret and variable in the top-level command index", () => {
    expect(TOP_HELP).toContain("secret");
    expect(TOP_HELP).toContain("variable");
  });

  it("strips -R before invoking the secret handler", async () => {
    await main();

    const options = vi.mocked(runAxiCli).mock.calls[0]?.[0];
    const ctx = {
      owner: "octo",
      name: "repo",
      nwo: "octo/repo",
      source: "flag",
    };

    await options.commands.secret(["list", "-R", "owner/name"], ctx);

    const { secretCommand } = await import("../src/commands/secret.js");
    expect(vi.mocked(secretCommand)).toHaveBeenCalledWith(["list"], ctx);
  });

  it("strips -R before invoking the variable handler", async () => {
    await main();

    const options = vi.mocked(runAxiCli).mock.calls[0]?.[0];
    const ctx = {
      owner: "octo",
      name: "repo",
      nwo: "octo/repo",
      source: "flag",
    };

    await options.commands.variable(["list", "-R", "owner/name"], ctx);

    const { variableCommand } = await import("../src/commands/variable.js");
    expect(vi.mocked(variableCommand)).toHaveBeenCalledWith(["list"], ctx);
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

  it("accepts --repo=value as a repo-context alias after the command", async () => {
    await main();

    const options = vi.mocked(runAxiCli).mock.calls[0]?.[0];
    const context = options.resolveContext({
      command: "release",
      args: ["create", "v1.0.0", "--repo=owner/name"],
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

  it("strips --repo=value before invoking release handlers when used as repo context", async () => {
    await main();

    const options = vi.mocked(runAxiCli).mock.calls[0]?.[0];
    const ctx = {
      owner: "octo",
      name: "repo",
      nwo: "octo/repo",
      source: "flag",
    };

    await options.commands.release(
      ["create", "v1.0.0", "--repo=owner/name", "--target", "main"],
      ctx,
    );

    expect(vi.mocked(releaseCommand)).toHaveBeenCalledWith(
      ["create", "v1.0.0", "--target", "main"],
      ctx,
    );
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
