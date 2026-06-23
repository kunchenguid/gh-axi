import { execFile } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AxiError } from "../../src/errors.js";
import { pushCommand, PUSH_HELP } from "../../src/commands/push.js";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

const mockedExecFile = vi.mocked(execFile);

type ExecFileCallback = (
  error: (Error & { code?: string | number }) | null,
  stdout: string,
  stderr: string,
) => void;

function mockGitResults(
  results: Array<{
    error?: (Error & { code?: string | number }) | null;
    stdout?: string;
    stderr?: string;
  }>,
) {
  mockedExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
    const result = results.shift() ?? {};
    (callback as ExecFileCallback)(
      result.error ?? null,
      result.stdout ?? "",
      result.stderr ?? "",
    );
    return {} as ReturnType<typeof execFile>;
  });
}

describe("pushCommand", () => {
  beforeEach(() => {
    mockedExecFile.mockReset();
  });

  it("returns command help", async () => {
    await expect(pushCommand(["--help"])).resolves.toBe(PUSH_HELP);
  });

  it("pushes the current branch by default", async () => {
    mockGitResults([
      { stdout: "feature/push\n" },
      {
        stderr:
          "To https://github.com/octo/repo.git\n" +
          " * [new branch]      HEAD -> feature/push\n" +
          "branch 'feature/push' set up to track 'origin/feature/push'.\n",
      },
    ]);

    const output = await pushCommand([]);

    expect(mockedExecFile).toHaveBeenNthCalledWith(
      1,
      "git",
      ["branch", "--show-current"],
      expect.any(Object),
      expect.any(Function),
    );
    expect(mockedExecFile).toHaveBeenNthCalledWith(
      2,
      "git",
      ["push", "--set-upstream", "origin", "HEAD:feature/push"],
      expect.any(Object),
      expect.any(Function),
    );
    expect(output).toContain("status: ok");
    expect(output).toContain("mode: current-branch");
    expect(output).toContain("branch: feature/push");
    expect(output).toContain("[new branch]");
  });

  it("pushes explicit refspecs with dry-run and follow-tags", async () => {
    mockGitResults([
      {
        stderr:
          "To https://github.com/octo/repo.git\n" +
          " * [new branch]      main -> main\n",
      },
    ]);

    const output = await pushCommand([
      "origin",
      "main:main",
      "--dry-run",
      "--follow-tags",
    ]);

    expect(mockedExecFile).toHaveBeenCalledWith(
      "git",
      ["push", "--dry-run", "--follow-tags", "origin", "main:main"],
      expect.any(Object),
      expect.any(Function),
    );
    expect(output).toContain("status: dry-run-ok");
    expect(output).toContain("mode: explicit");
    expect(output).toContain("tags: follow");
  });

  it("splits all-branches plus tags into two git pushes", async () => {
    mockGitResults([
      {
        stderr:
          "To https://github.com/octo/repo.git\n = [up to date]      main -> main\n",
      },
      {
        stderr:
          "To https://github.com/octo/repo.git\n * [new tag]         v1.0.0 -> v1.0.0\n",
      },
    ]);

    const output = await pushCommand(["upstream", "--all", "--tags"]);

    expect(mockedExecFile).toHaveBeenNthCalledWith(
      1,
      "git",
      ["push", "--all", "upstream"],
      expect.any(Object),
      expect.any(Function),
    );
    expect(mockedExecFile).toHaveBeenNthCalledWith(
      2,
      "git",
      ["push", "--tags", "upstream"],
      expect.any(Object),
      expect.any(Function),
    );
    expect(output).toContain("mode: all+tags");
  });

  it("maps git push failures to structured errors", async () => {
    const error = new Error("exit 1") as Error & { code: number };
    error.code = 1;
    mockGitResults([{ error, stderr: "fatal: unable to access repository\n" }]);

    try {
      await pushCommand(["origin", "main:main"]);
      throw new Error("Expected pushCommand to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AxiError);
      expect((e as AxiError).code).toBe("GIT_PUSH_FAILED");
    }
  });
});
