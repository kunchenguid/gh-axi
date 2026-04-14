import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/gh.js", () => ({
  ghJson: vi.fn(),
  ghExec: vi.fn(),
  ghRaw: vi.fn(),
}));

import { ghJson, ghExec } from "../../src/gh.js";
import { runCommand, RUN_HELP } from "../../src/commands/run.js";
import { AxiError } from "../../src/errors.js";
import type { RepoContext } from "../../src/context.js";

const mockedGhJson = vi.mocked(ghJson);
const mockedGhExec = vi.mocked(ghExec);

const ctx: RepoContext = {
  owner: "octo",
  name: "repo",
  nwo: "octo/repo",
  source: "flag",
};

describe("runCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("router", () => {
    it("returns help when --help is passed", async () => {
      const result = await runCommand(["--help"]);
      expect(result).toBe(RUN_HELP);
    });

    it("returns help when no subcommand is given", async () => {
      const result = await runCommand([]);
      expect(result).toBe(RUN_HELP);
    });

    it("returns error for unknown subcommand", async () => {
      const result = await runCommand(["unknown"]);
      expect(result).toContain("Unknown subcommand: unknown");
    });
  });

  describe("list", () => {
    it("returns runs list", async () => {
      mockedGhJson.mockResolvedValue([
        {
          databaseId: 100,
          displayTitle: "CI Build",
          status: "completed",
          conclusion: "success",
          workflowName: "CI",
          headBranch: "main",
          event: "push",
          createdAt: "2024-01-01T00:00:00Z",
        },
        {
          databaseId: 101,
          displayTitle: "Tests",
          status: "in_progress",
          conclusion: null,
          workflowName: "Test",
          headBranch: "dev",
          event: "pull_request",
          createdAt: "2024-01-02T00:00:00Z",
        },
      ]);

      const result = await runCommand(["list"], ctx);

      expect(result).toContain("count: 2");
      expect(result).toContain("CI Build");
      expect(result).toContain("Tests");
    });

    it("uses default compact --json fields when --fields is not passed", async () => {
      mockedGhJson.mockResolvedValue([]);
      await runCommand(["list"], ctx);

      const callArgs = mockedGhJson.mock.calls[0][0] as string[];
      const jsonIdx = callArgs.indexOf("--json");
      const jsonValue = callArgs[jsonIdx + 1];
      expect(jsonValue).not.toContain("headSha");
      expect(jsonValue).not.toContain("number");
      expect(jsonValue).toContain("databaseId");
      expect(jsonValue).toContain("displayTitle");
    });

    it("extends --json and schema when --fields is passed", async () => {
      mockedGhJson.mockResolvedValue([
        {
          databaseId: 100,
          displayTitle: "CI Build",
          status: "completed",
          conclusion: "success",
          workflowName: "CI",
          headBranch: "main",
          event: "push",
          createdAt: "2024-01-01T00:00:00Z",
          headSha: "abc123",
          number: 42,
        },
      ]);

      const result = await runCommand(
        ["list", "--fields", "headSha,number"],
        ctx,
      );

      const callArgs = mockedGhJson.mock.calls[0][0] as string[];
      const jsonIdx = callArgs.indexOf("--json");
      const jsonValue = callArgs[jsonIdx + 1];
      expect(jsonValue).toContain("headSha");
      expect(jsonValue).toContain("number");

      expect(result).toContain("abc123");
    });

    it("throws VALIDATION_ERROR for unknown --fields", async () => {
      await expect(
        runCommand(["list", "--fields", "bogusField"], ctx),
      ).rejects.toThrow(AxiError);

      try {
        await runCommand(["list", "--fields", "bogusField"], ctx);
      } catch (e) {
        expect((e as AxiError).code).toBe("VALIDATION_ERROR");
        expect((e as AxiError).message).toContain("bogusField");
      }
    });
  });

  describe("view", () => {
    it("returns run detail with jobs", async () => {
      mockedGhJson.mockResolvedValue({
        databaseId: 100,
        displayTitle: "CI Build",
        status: "completed",
        conclusion: "success",
        workflowName: "CI",
        headBranch: "main",
        createdAt: "2024-01-01T00:00:00Z",
        jobs: [
          { name: "build", status: "completed", conclusion: "success" },
          { name: "test", status: "completed", conclusion: "failure" },
        ],
      });

      const result = await runCommand(["view", "100"], ctx);

      expect(result).toContain("CI Build");
      expect(result).toContain("build");
      expect(result).toContain("test");
    });

    it("omits help suggestions from detail view", async () => {
      mockedGhJson.mockResolvedValue({
        databaseId: 100,
        displayTitle: "CI",
        status: "completed",
        conclusion: "success",
        workflowName: "CI",
        headBranch: "main",
        createdAt: "2024-01-01T00:00:00Z",
        jobs: [],
      });
      const result = await runCommand(["view", "100"], ctx);
      expect(result).not.toMatch(/^help\[/m);
    });

    it("includes job databaseId in job listing", async () => {
      mockedGhJson.mockResolvedValue({
        databaseId: 100,
        displayTitle: "CI Build",
        status: "completed",
        conclusion: "failure",
        workflowName: "CI",
        headBranch: "main",
        createdAt: "2024-01-01T00:00:00Z",
        jobs: [
          {
            databaseId: 501,
            name: "build",
            status: "completed",
            conclusion: "success",
            steps: [],
          },
          {
            databaseId: 502,
            name: "test",
            status: "completed",
            conclusion: "failure",
            steps: [],
          },
        ],
      });

      const result = await runCommand(["view", "100"], ctx);

      expect(result).toContain("501");
      expect(result).toContain("502");
    });

    it("shows specific job with steps in job-only mode", async () => {
      mockedGhJson.mockResolvedValue({
        databaseId: 100,
        displayTitle: "CI Build",
        status: "completed",
        conclusion: "failure",
        workflowName: "CI",
        headBranch: "main",
        createdAt: "2024-01-01T00:00:00Z",
        jobs: [
          {
            databaseId: 501,
            name: "build",
            status: "completed",
            conclusion: "success",
            steps: [],
          },
          {
            databaseId: 502,
            name: "test",
            status: "completed",
            conclusion: "failure",
            steps: [
              {
                name: "Set up job",
                number: 1,
                status: "completed",
                conclusion: "success",
              },
              {
                name: "Run tests",
                number: 2,
                status: "completed",
                conclusion: "failure",
              },
              {
                name: "Teardown",
                number: 3,
                status: "completed",
                conclusion: "skipped",
              },
            ],
          },
        ],
      });

      const result = await runCommand(["view", "--job", "502"], ctx);

      // Should show the job detail
      expect(result).toContain("test");
      expect(result).toContain("failure");
      // Should show steps
      expect(result).toContain("Set up job");
      expect(result).toContain("Run tests");
      expect(result).toContain("Teardown");
    });

    it("rejects a trailing run id after --job", async () => {
      await expect(
        runCommand(["view", "--job", "502", "100"], ctx),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: "Specify either a run ID or --job, not both",
      });
      expect(mockedGhExec).not.toHaveBeenCalled();
      expect(mockedGhJson).not.toHaveBeenCalled();
    });

    it("accepts job-only view invocations", async () => {
      mockedGhJson.mockResolvedValue({
        databaseId: 100,
        displayTitle: "CI Build",
        status: "completed",
        conclusion: "failure",
        workflowName: "CI",
        headBranch: "main",
        createdAt: "2024-01-01T00:00:00Z",
        jobs: [
          {
            databaseId: 502,
            name: "test",
            status: "completed",
            conclusion: "failure",
            steps: [
              {
                name: "Run tests",
                number: 1,
                status: "completed",
                conclusion: "failure",
              },
            ],
          },
        ],
      });

      const result = await runCommand(["view", "--job", "502"], ctx);

      expect(mockedGhJson).toHaveBeenCalledWith(
        [
          "run",
          "view",
          "--job",
          "502",
          "--json",
          "databaseId,displayTitle,status,conclusion,workflowName,headBranch,createdAt,jobs",
        ],
        ctx,
      );
      expect(result).toContain("Run tests");
    });

    it("rejects combining a run id with --job", async () => {
      await expect(
        runCommand(["view", "100", "--job", "502"], ctx),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: "Specify either a run ID or --job, not both",
      });
      expect(mockedGhExec).not.toHaveBeenCalled();
      expect(mockedGhJson).not.toHaveBeenCalled();
    });

    it("throws error when --job references nonexistent job", async () => {
      mockedGhJson.mockResolvedValue({
        databaseId: 100,
        displayTitle: "CI Build",
        status: "completed",
        conclusion: "failure",
        workflowName: "CI",
        headBranch: "main",
        createdAt: "2024-01-01T00:00:00Z",
        jobs: [
          {
            databaseId: 501,
            name: "build",
            status: "completed",
            conclusion: "success",
            steps: [],
          },
        ],
      });

      await expect(
        runCommand(["view", "100", "--job", "999"], ctx),
      ).rejects.toThrow(AxiError);
    });

    it("throws error when --job is provided and the run has no jobs", async () => {
      mockedGhJson.mockResolvedValue({
        databaseId: 100,
        displayTitle: "CI Build",
        status: "completed",
        conclusion: "failure",
        workflowName: "CI",
        headBranch: "main",
        createdAt: "2024-01-01T00:00:00Z",
        jobs: [],
      });

      await expect(runCommand(["view", "--job", "999"], ctx)).rejects.toThrow(
        "Job 999 not found in run 100",
      );
    });

    it("rejects --job without a value", async () => {
      await expect(
        runCommand(["view", "100", "--job", "--log"], ctx),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: "Missing value for --job",
      });
      expect(mockedGhExec).not.toHaveBeenCalled();
      expect(mockedGhJson).not.toHaveBeenCalled();
    });

    it("rejects --conclusion without a value", async () => {
      await expect(
        runCommand(["view", "100", "--conclusion", "--job", "502"], ctx),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: "Missing value for --conclusion",
      });
      expect(mockedGhExec).not.toHaveBeenCalled();
      expect(mockedGhJson).not.toHaveBeenCalled();
    });
  });

  describe("view --log", () => {
    it("wraps log output in TOON envelope", async () => {
      mockedGhExec.mockResolvedValue("build step 1\nbuild step 2\ndone\n");
      const result = await runCommand(["view", "100", "--log"], ctx);
      expect(result).toContain("run_log:");
      expect(result).toContain("mode: log");
      expect(result).toContain("build step 1");
      expect(result).toContain("truncated: false");
    });

    it("wraps log-failed output in TOON envelope", async () => {
      mockedGhExec.mockResolvedValue("error in step 3\n");
      const result = await runCommand(["view", "100", "--log-failed"], ctx);
      expect(result).toContain("run_log:");
      expect(result).toContain("mode: log-failed");
      expect(result).toContain("error in step 3");
    });

    it("rejects combining a run id with --job in log mode", async () => {
      await expect(
        runCommand(["view", "100", "--log", "--job", "555"], ctx),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: "Specify either a run ID or --job, not both",
      });
      expect(mockedGhExec).not.toHaveBeenCalled();
      expect(mockedGhJson).not.toHaveBeenCalled();
    });

    it("accepts job-only log invocations", async () => {
      mockedGhExec.mockResolvedValue("job-specific log output\n");
      mockedGhJson.mockResolvedValue({ databaseId: 100 });
      const result = await runCommand(["view", "--log", "--job", "555"], ctx);

      expect(mockedGhExec).toHaveBeenCalledWith(
        ["run", "view", "--log", "--job", "555"],
        ctx,
      );
      expect(result).toContain("job-specific log output");
    });

    it("records the resolved run id in job-only log envelopes", async () => {
      mockedGhExec.mockResolvedValue("job-specific log output\n");
      mockedGhJson.mockResolvedValue({ databaseId: 100 });

      const result = await runCommand(["view", "--log", "--job", "555"], ctx);

      expect(mockedGhJson).toHaveBeenCalledWith(
        ["run", "view", "--job", "555", "--json", "databaseId"],
        ctx,
      );
      expect(result).toContain('run: "100"');
      expect(result).not.toContain("run: 555");
    });

    it("passes --job to gh CLI in log-failed job-only mode", async () => {
      mockedGhExec.mockResolvedValue("job-specific failure\n");
      mockedGhJson.mockResolvedValue({ databaseId: 100 });
      const result = await runCommand(
        ["view", "--log-failed", "--job", "555"],
        ctx,
      );
      expect(mockedGhExec).toHaveBeenCalledWith(
        ["run", "view", "--log-failed", "--job", "555"],
        ctx,
      );
      expect(result).toContain("job-specific failure");
    });
  });

  describe("watch", () => {
    it("wraps watch output in TOON envelope", async () => {
      mockedGhExec.mockResolvedValue("Run completed\n");
      const result = await runCommand(["watch", "100"], ctx);
      expect(result).toContain("run_watch:");
      expect(result).toContain("Run completed");
    });
  });

  describe("cancel", () => {
    it("returns already_completed when run is already completed (idempotent)", async () => {
      mockedGhJson.mockResolvedValue({
        status: "completed",
        conclusion: "success",
      });

      const result = await runCommand(["cancel", "100"], ctx);

      expect(result).toContain("already_completed");
      expect(mockedGhExec).not.toHaveBeenCalled();
    });
  });
});
