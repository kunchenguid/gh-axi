import { describe, expect, it, vi } from "vitest";
import {
  resolveStackLinkRemote,
  resolveStackRemote,
} from "../src/stack-remote.js";

type Result = { stdout: string; exitCode: number };

function runner(responses: Record<string, Result>) {
  return async (args: string[]): Promise<Result> =>
    responses[args.join(" ")] ?? { stdout: "", exitCode: 1 };
}

describe("resolveStackRemote", () => {
  it("uses git's configured remote priority", async () => {
    const args = await resolveStackRemote(
      ["--open", "--auto"],
      runner({
        "symbolic-ref --quiet --short HEAD": {
          stdout: "feature\n",
          exitCode: 0,
        },
        "config --get branch.feature.pushRemote": {
          stdout: "fork\n",
          exitCode: 0,
        },
      }),
    );

    expect(args).toEqual(["--open", "--auto", "--remote", "fork"]);
  });

  it("rejects multiple remotes without a configured default", async () => {
    await expect(
      resolveStackRemote(
        [],
        runner({
          "symbolic-ref --quiet --short HEAD": {
            stdout: "feature\n",
            exitCode: 0,
          },
          remote: { stdout: "fork\norigin\n", exitCode: 0 },
        }),
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("--remote <name>"),
    });
  });

  it("preserves an explicit remote without reading git configuration", async () => {
    const runGit = vi.fn();

    const args = await resolveStackRemote(["--remote", "upstream"], runGit);

    expect(args).toEqual(["--remote", "upstream"]);
    expect(runGit).not.toHaveBeenCalled();
  });

  it("uses the first linked local branch's push remote", async () => {
    const runGit = vi.fn(
      runner({
        "for-each-ref --format=%(refname:short) refs/heads": {
          stdout: "current\nfeature-a\nfeature-b\n",
          exitCode: 0,
        },
        "config --get branch.feature-a.pushRemote": {
          stdout: "fork\n",
          exitCode: 0,
        },
      }),
    );

    const args = await resolveStackLinkRemote(
      ["feature-a", "feature-b"],
      ["feature-a", "feature-b"],
      runGit,
    );

    expect(args).toEqual(["feature-a", "feature-b", "--remote", "fork"]);
    expect(runGit).toHaveBeenCalledWith([
      "config",
      "--get",
      "branch.feature-a.pushRemote",
    ]);
    expect(runGit).not.toHaveBeenCalledWith([
      "symbolic-ref",
      "--quiet",
      "--short",
      "HEAD",
    ]);
  });

  it("does not inject a remote when links contain only pull requests", async () => {
    const runGit = vi.fn(
      runner({
        "for-each-ref --format=%(refname:short) refs/heads": {
          stdout: "feature-a\n",
          exitCode: 0,
        },
      }),
    );
    const refs = ["42", "https://github.com/owner/repo/pull/43"];

    const args = await resolveStackLinkRemote(refs, refs, runGit);

    expect(args).toEqual(refs);
    expect(runGit).toHaveBeenCalledTimes(1);
  });
});
