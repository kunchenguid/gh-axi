import { describe, expect, it, vi } from "vitest";
import { resolveStackRemote } from "../src/stack-remote.js";

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
});
