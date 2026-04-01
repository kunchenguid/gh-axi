import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock all command modules
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
vi.mock("../src/hooks.js", () => ({
  ensureHooks: vi.fn(),
}));

// Mock resolveRepo to avoid git calls
vi.mock("../src/context.js", () => ({
  resolveRepo: vi.fn().mockReturnValue({
    owner: "octo",
    name: "repo",
    nwo: "octo/repo",
    source: "git",
  }),
}));

import { main } from "../src/cli.js";
import { AxiError } from "../src/errors.js";
import { issueCommand } from "../src/commands/issue.js";
import { repoCommand } from "../src/commands/repo.js";
import { labelCommand } from "../src/commands/label.js";
import { apiCommand } from "../src/commands/api.js";
import { homeCommand } from "../src/commands/home.js";
import { resolveRepo } from "../src/context.js";

describe("main CLI", () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(homeCommand).mockResolvedValue("home output");
    vi.mocked(issueCommand).mockResolvedValue("issue output");
    vi.mocked(repoCommand).mockResolvedValue("repo output");
    vi.mocked(labelCommand).mockResolvedValue("label output");
    vi.mocked(apiCommand).mockResolvedValue("api output");
    vi.mocked(resolveRepo).mockReturnValue({
      owner: "octo",
      name: "repo",
      nwo: "octo/repo",
      source: "git",
    });
    writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    process.exitCode = undefined;
  });

  afterEach(() => {
    writeSpy.mockRestore();
    process.exitCode = undefined;
  });

  it("routes to home command when no command given", async () => {
    await main([]);
    expect(vi.mocked(homeCommand)).toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalledWith(
      expect.stringContaining("home output"),
    );
  });

  it("routes to issue command", async () => {
    await main(["issue", "list"]);
    expect(vi.mocked(issueCommand)).toHaveBeenCalledWith(
      ["list"],
      expect.any(Object),
    );
  });

  it("routes to repo command", async () => {
    await main(["repo", "view"]);
    expect(vi.mocked(repoCommand)).toHaveBeenCalledWith(
      ["view"],
      expect.any(Object),
    );
  });

  it("routes to label command", async () => {
    await main(["label", "list"]);
    expect(vi.mocked(labelCommand)).toHaveBeenCalledWith(
      ["list"],
      expect.any(Object),
    );
  });

  it("routes to api command", async () => {
    await main(["api", "/repos/octo/repo"]);
    expect(vi.mocked(apiCommand)).toHaveBeenCalledWith(
      ["/repos/octo/repo"],
      expect.any(Object),
    );
  });

  it("outputs top-level help with --help flag", async () => {
    await main(["--help"]);
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("gh-axi"));
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("commands"));
  });

  it("outputs command-level help with command --help", async () => {
    await main(["issue", "--help"]);
    expect(writeSpy).toHaveBeenCalledWith("issue help");
  });

  it("returns exit code 2 for unknown command (usage error)", async () => {
    await main(["notacommand"]);
    expect(writeSpy).toHaveBeenCalledWith(
      expect.stringContaining("Unknown command: notacommand"),
    );
    expect(process.exitCode).toBe(2);
  });

  it("extracts --repo flag and passes to resolveRepo", async () => {
    await main(["-R", "owner/name", "issue", "list"]);
    expect(vi.mocked(resolveRepo)).toHaveBeenCalledWith("owner/name");
    expect(vi.mocked(issueCommand)).toHaveBeenCalledWith(
      ["list"],
      expect.any(Object),
    );
  });

  it("extracts long --repo flag", async () => {
    await main(["--repo", "owner/name", "repo", "view"]);
    expect(vi.mocked(resolveRepo)).toHaveBeenCalledWith("owner/name");
  });

  it("sets exitCode 1 on generic command error", async () => {
    vi.mocked(homeCommand).mockRejectedValue(new Error("boom"));
    await main([]);
    expect(process.exitCode).toBe(1);
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("boom"));
  });

  it("returns exit code 2 for VALIDATION_ERROR (missing required flag)", async () => {
    vi.mocked(issueCommand).mockRejectedValue(
      new AxiError("--title is required", "VALIDATION_ERROR"),
    );
    await main(["issue", "create"]);
    expect(process.exitCode).toBe(2);
    expect(writeSpy).toHaveBeenCalledWith(
      expect.stringContaining("--title is required"),
    );
  });

  it("returns exit code 1 for NOT_FOUND error", async () => {
    vi.mocked(issueCommand).mockRejectedValue(
      new AxiError("Issue #999 does not exist", "NOT_FOUND"),
    );
    await main(["issue", "view", "999"]);
    expect(process.exitCode).toBe(1);
    expect(writeSpy).toHaveBeenCalledWith(
      expect.stringContaining("Issue #999"),
    );
  });

  it("returns exit code 1 for AUTH_REQUIRED error", async () => {
    vi.mocked(issueCommand).mockRejectedValue(
      new AxiError("GitHub auth required", "AUTH_REQUIRED"),
    );
    await main(["issue", "list"]);
    expect(process.exitCode).toBe(1);
  });

  it("returns exit code 1 for FORBIDDEN error", async () => {
    vi.mocked(issueCommand).mockRejectedValue(
      new AxiError("Insufficient permissions", "FORBIDDEN"),
    );
    await main(["issue", "list"]);
    expect(process.exitCode).toBe(1);
  });

  it("strips --session-start and falls through to dashboard", async () => {
    await main(["--session-start"]);
    expect(vi.mocked(homeCommand)).toHaveBeenCalled();
  });
});
