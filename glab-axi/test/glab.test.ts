import { describe, it, expect, beforeEach, vi } from "vitest";
import { execFile } from "node:child_process";
import {
  glabJson,
  glabExec,
  resolveGlabBin,
} from "../src/glab.js";
import { AxiError } from "../src/errors.js";
import type { ProjectContext } from "../src/context.js";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

const mockedExecFile = vi.mocked(execFile);
type ExecFileCallback = (
  error: Error | null,
  stdout: string,
  stderr: string,
) => void;

function mockExecFileResult(
  error: (Error & { code?: string | number }) | null,
  stdout: string,
  stderr: string,
) {
  mockedExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
    (callback as ExecFileCallback)(error, stdout, stderr);
    return {} as ReturnType<typeof execFile>;
  });
}

function mockExecFileEnoent() {
  mockedExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
    const err = new Error("spawn glab ENOENT") as Error & { code: string };
    err.code = "ENOENT";
    (callback as ExecFileCallback)(err, "", "");
    return {} as ReturnType<typeof execFile>;
  });
}

/** A non-null execFile error carrying a numeric exit code (non-zero exit). */
function exitError(code: number): Error & { code: number } {
  const err = new Error("exited with code") as Error & { code: number };
  err.code = code;
  return err;
}

const flagCtx: ProjectContext = { fullPath: "group/project", source: "flag" };
const gitCtx: ProjectContext = { fullPath: "group/project", source: "git" };

describe("resolveGlabBin", () => {
  it("defaults to glab on PATH", () => {
    delete process.env["GLAB_BIN"];
    expect(resolveGlabBin()).toBe("glab");
  });

  it("honors GLAB_BIN", () => {
    process.env["GLAB_BIN"] = "/custom/glab";
    expect(resolveGlabBin()).toBe("/custom/glab");
    delete process.env["GLAB_BIN"];
  });
});

describe("glabJson", () => {
  beforeEach(() => {
    mockedExecFile.mockReset();
    delete process.env["GLAB_BIN"];
  });

  it("parses JSON output", async () => {
    mockExecFileResult(null, '{"iid": 7, "state": "opened"}', "");
    const result = await glabJson<{ iid: number }>(["mr", "view", "7", "-F", "json"]);
    expect(result.iid).toBe(7);
    expect(mockedExecFile.mock.calls[0]?.[0]).toBe("glab");
    expect(mockedExecFile.mock.calls[0]?.[1]).toEqual([
      "mr",
      "view",
      "7",
      "-F",
      "json",
    ]);
  });

  it("appends -R for flag/env project sources", async () => {
    mockExecFileResult(null, "[]", "");
    await glabJson(["mr", "list", "-F", "json"], flagCtx);
    expect(mockedExecFile.mock.calls[0]?.[1]).toEqual([
      "mr",
      "list",
      "-F",
      "json",
      "-R",
      "group/project",
    ]);
  });

  it("hands a URL selector to the child verbatim", async () => {
    mockExecFileResult(null, "[]", "");
    await glabJson(["mr", "list", "-F", "json"], {
      fullPath: "https://gitlab.corp.com/team/app",
      source: "flag",
    });
    const args = mockedExecFile.mock.calls[0]?.[1] as string[];
    expect(args[args.indexOf("-R") + 1]).toBe("https://gitlab.corp.com/team/app");
  });

  it("appends -R for env sources too", async () => {
    mockExecFileResult(null, "[]", "");
    await glabJson(["mr", "list", "-F", "json"], {
      fullPath: "env/project",
      source: "env",
    });
    expect(mockedExecFile.mock.calls[0]?.[1]).toContain("-R");
  });

  it("lets glab auto-detect for git checkout sources (no -R)", async () => {
    mockExecFileResult(null, "[]", "");
    await glabJson(["mr", "list", "-F", "json"], gitCtx);
    expect(mockedExecFile.mock.calls[0]?.[1]).toEqual([
      "mr",
      "list",
      "-F",
      "json",
    ]);
  });

  it("uses GLAB_BIN when set", async () => {
    process.env["GLAB_BIN"] = "/custom/glab";
    mockExecFileResult(null, "[]", "");
    await glabJson(["mr", "list", "-F", "json"]);
    expect(mockedExecFile.mock.calls[0]?.[0]).toBe("/custom/glab");
    delete process.env["GLAB_BIN"];
  });

  it("throws GLAB_NOT_INSTALLED on ENOENT", async () => {
    mockExecFileEnoent();
    await expect(glabJson(["mr", "list"])).rejects.toMatchObject({
      code: "GLAB_NOT_INSTALLED",
    });
  });

  it("names an overridden GLAB_BIN that is not executable", async () => {
    process.env["GLAB_BIN"] = "/nope/glab";
    mockExecFileEnoent();
    await expect(glabJson(["mr", "list"])).rejects.toMatchObject({
      code: "GLAB_NOT_INSTALLED",
      message: /\/nope\/glab/,
    });
    delete process.env["GLAB_BIN"];
  });

  it("maps glab stderr through mapGlabError", async () => {
    mockExecFileResult(exitError(1), "", "glab: 401 Unauthorized (HTTP 401)");
    await expect(glabJson(["mr", "list"])).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });

  it("throws UNKNOWN on non-JSON stdout", async () => {
    mockExecFileResult(null, "not json at all", "");
    await expect(glabJson(["mr", "view", "1", "-F", "json"])).rejects.toThrow(
      AxiError,
    );
  });
});

describe("glabExec", () => {
  beforeEach(() => {
    mockedExecFile.mockReset();
  });

  it("glabExec returns stdout on success", async () => {
    mockExecFileResult(null, "output", "");
    await expect(glabExec(["repo", "view"])).resolves.toBe("output");
  });

  it("glabExec maps non-zero exits", async () => {
    mockExecFileResult(exitError(1), "", "glab: 403 Forbidden (HTTP 403)");
    await expect(glabExec(["mr", "merge", "1"])).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
