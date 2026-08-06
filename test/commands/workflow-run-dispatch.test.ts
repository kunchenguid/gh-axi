import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFile } from "node:child_process";
import { workflowCommand } from "../../src/commands/workflow.js";
import { AxiError } from "../../src/errors.js";
import type { RepoContext } from "../../src/context.js";

// Deliberately does NOT mock src/gh.js: this exercises the real `workflow run`
// path through gh.ts and the error classifier, stubbing only the gh boundary.
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

const mockedExecFile = vi.mocked(execFile);
type ExecFileCallback = (
  error: Error | null,
  stdout: string,
  stderr: string,
) => void;

/** Capture the argv handed to gh, and reply with a canned exit/stdout/stderr. */
function stubGh(
  error: (Error & { code?: string | number }) | null,
  stdout: string,
  stderr: string,
): { argv: () => string[] } {
  let seen: string[] = [];
  mockedExecFile.mockImplementation((_cmd, args, _opts, callback) => {
    seen = args as string[];
    (callback as ExecFileCallback)(error, stdout, stderr);
    return {} as ReturnType<typeof execFile>;
  });
  return { argv: () => seen };
}

function ghFailure(): Error & { code: number } {
  return Object.assign(new Error("gh exited 1"), { code: 1 });
}

const ctx: RepoContext = {
  owner: "octo",
  name: "repo",
  nwo: "octo/repo",
  source: "flag",
};

describe("workflow run dispatch", () => {
  beforeEach(() => {
    mockedExecFile.mockReset();
  });

  it("dispatches successfully and reports the trigger", async () => {
    const gh = stubGh(
      null,
      "https://github.com/octo/repo/actions/runs/1\n",
      "",
    );

    const result = await workflowCommand(
      ["run", "dispatch-check.yml", "--ref", "main", "--field", "note=hi"],
      ctx,
    );

    expect(result).toContain("triggered: ok");
    expect(gh.argv()).toEqual([
      "workflow",
      "run",
      "dispatch-check.yml",
      "--ref",
      "main",
      "--field",
      "note=hi",
      "--repo",
      "octo/repo",
    ]);
  });

  // Regression: gh appends a `gh auth login` hint to its repo-resolution
  // failure. gh-axi used to substring-match that hint and report AUTH_REQUIRED,
  // so a dispatch under a perfectly valid workflow-scoped token looked like an
  // auth gap even though `gh workflow run -R owner/repo` succeeded.
  it("does not report AUTH_REQUIRED when gh only failed to resolve the repo", async () => {
    stubGh(
      ghFailure(),
      "",
      "none of the git remotes configured for this repository point to a known GitHub host. To tell gh about a new GitHub host, please use `gh auth login`\n",
    );

    const err = await workflowCommand(["run", "dispatch-check.yml"]).catch(
      (e: unknown) => e as AxiError,
    );

    expect(err).toBeInstanceOf(AxiError);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.suggestions.join(" ")).toContain("-R <owner>/<name>");
  });

  it("still reports AUTH_REQUIRED when gh is genuinely not authenticated", async () => {
    stubGh(
      ghFailure(),
      "",
      "To get started with GitHub CLI, please run:  gh auth login\n",
    );

    const err = await workflowCommand(["run", "dispatch-check.yml"], ctx).catch(
      (e: unknown) => e as AxiError,
    );

    expect(err).toBeInstanceOf(AxiError);
    expect(err.code).toBe("AUTH_REQUIRED");
  });

  it("still reports AUTH_REQUIRED for gh's 401 hint", async () => {
    stubGh(
      ghFailure(),
      "",
      "HTTP 401: Bad credentials (https://api.github.com/repos/octo/repo)\nTry authenticating with:  gh auth login\n",
    );

    const err = await workflowCommand(["run", "dispatch-check.yml"], ctx).catch(
      (e: unknown) => e as AxiError,
    );

    expect(err).toBeInstanceOf(AxiError);
    expect(err.code).toBe("AUTH_REQUIRED");
  });

  it("surfaces a missing workflow_dispatch trigger as a validation error, not auth", async () => {
    stubGh(
      ghFailure(),
      "",
      "could not create workflow dispatch event: HTTP 422: Workflow does not have 'workflow_dispatch' trigger (https://api.github.com/repos/octo/repo/actions/workflows/1/dispatches)\n",
    );

    const err = await workflowCommand(["run", "dispatch-check.yml"], ctx).catch(
      (e: unknown) => e as AxiError,
    );

    expect(err).toBeInstanceOf(AxiError);
    expect(err.code).toBe("VALIDATION_ERROR");
  });
});
