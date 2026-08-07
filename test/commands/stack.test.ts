import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/gh.js", () => ({
  ghJson: vi.fn(),
  ghExec: vi.fn(),
  ghRaw: vi.fn(),
}));

import { ghJson, ghExec, ghRaw } from "../../src/gh.js";
import { stackCommand, STACK_HELP } from "../../src/commands/stack.js";

const mockedGhJson = vi.mocked(ghJson);
const mockedGhExec = vi.mocked(ghExec);
const mockedGhRaw = vi.mocked(ghRaw);

/** gh-stack writes its result to stderr and leaves stdout empty. */
function ghStderr(stderr: string) {
  return { stdout: "", stderr, exitCode: 0 };
}

describe("stackCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedGhRaw.mockResolvedValue(ghStderr(""));
  });

  describe("router", () => {
    it("returns help when --help is passed", async () => {
      const result = await stackCommand(["--help"]);
      expect(result).toBe(STACK_HELP);
    });

    it("returns help when no subcommand is given", async () => {
      const result = await stackCommand([]);
      expect(result).toBe(STACK_HELP);
    });

    it("returns error for unknown subcommand", async () => {
      const result = await stackCommand(["frobnicate"]);
      expect(result).toContain("Unknown subcommand: frobnicate");
    });

    it.each([["modify"], ["switch"], ["alias"], ["feedback"]])(
      "points unwrapped subcommand %s at plain gh stack",
      async (sub: string) => {
        const result = await stackCommand([sub]);
        expect(result).toContain(`gh stack ${sub}`);
        expect(result).not.toContain("interactive-only");
        expect(mockedGhRaw).not.toHaveBeenCalled();
      },
    );
  });

  describe("view", () => {
    it("fetches JSON and renders it as TOON", async () => {
      mockedGhJson.mockResolvedValue({
        branches: [{ name: "feat-a", pr: 1 }],
      });

      const result = await stackCommand(["view"]);

      expect(mockedGhJson).toHaveBeenCalledWith(["stack", "view", "--json"]);
      expect(result).toContain("feat-a");
    });

    it("passes --short through as plain text", async () => {
      mockedGhExec.mockResolvedValue("feat-a\nfeat-b\n");

      const result = await stackCommand(["view", "--short"]);

      expect(mockedGhExec).toHaveBeenCalledWith(["stack", "view", "--short"]);
      expect(result).toContain("feat-a");
      expect(mockedGhJson).not.toHaveBeenCalled();
    });

    it.each([[["--shrot"]], [["--full"]], [["-x"]], [["feat-a"]]])(
      "rejects %j instead of silently ignoring it",
      async (extra: string[]) => {
        await expect(stackCommand(["view", ...extra])).rejects.toMatchObject({
          code: "VALIDATION_ERROR",
        });
        expect(mockedGhJson).not.toHaveBeenCalled();
        expect(mockedGhExec).not.toHaveBeenCalled();
      },
    );

    it("returns help for --help rather than dumping the stack", async () => {
      const result = await stackCommand(["view", "--help"]);

      expect(result).toBe(STACK_HELP);
      expect(mockedGhJson).not.toHaveBeenCalled();
    });
  });

  describe("init", () => {
    it("requires at least one branch name (no-arg init is interactive)", async () => {
      await expect(stackCommand(["init"])).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
      expect(mockedGhRaw).not.toHaveBeenCalled();
    });

    it("forwards branches and --base verbatim", async () => {
      mockedGhRaw.mockResolvedValue(ghStderr("✓ created stack\n"));

      const result = await stackCommand([
        "init",
        "-b",
        "develop",
        "feat-a",
        "feat-b",
      ]);

      expect(mockedGhRaw).toHaveBeenCalledWith([
        "stack",
        "init",
        "-b",
        "develop",
        "feat-a",
        "feat-b",
      ]);
      expect(result).toContain("created stack");
    });
  });

  describe("add", () => {
    it("forwards branch name", async () => {
      await stackCommand(["add", "feat-c"]);

      expect(mockedGhRaw).toHaveBeenCalledWith(["stack", "add", "feat-c"]);
    });

    it("requires -m when staging with -A (editor trap)", async () => {
      await expect(stackCommand(["add", "-A"])).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
      expect(mockedGhRaw).not.toHaveBeenCalled();
    });

    it("requires -m when staging with -u (editor trap)", async () => {
      await expect(stackCommand(["add", "-u"])).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
    });

    it("accepts -A with -m", async () => {
      await stackCommand(["add", "-A", "-m", "add feature", "feat-c"]);

      expect(mockedGhRaw).toHaveBeenCalledWith([
        "stack",
        "add",
        "-A",
        "-m",
        "add feature",
        "feat-c",
      ]);
    });

    it("accepts bundled -Am", async () => {
      await stackCommand(["add", "-Am", "add feature"]);

      expect(mockedGhRaw).toHaveBeenCalledWith([
        "stack",
        "add",
        "-Am",
        "add feature",
      ]);
    });
  });

  describe("submit", () => {
    it("appends --auto so the interactive editor never opens", async () => {
      mockedGhRaw.mockResolvedValue(ghStderr("✓ created 2 pull requests\n"));

      const result = await stackCommand(["submit"]);

      expect(mockedGhRaw).toHaveBeenCalledWith(["stack", "submit", "--auto"]);
      expect(result).toContain("created 2 pull requests");
    });

    it("does not duplicate an explicit --auto", async () => {
      await stackCommand(["submit", "--auto", "--open"]);

      expect(mockedGhRaw).toHaveBeenCalledWith([
        "stack",
        "submit",
        "--auto",
        "--open",
      ]);
    });
  });

  describe("merge", () => {
    it("refuses to merge without --yes", async () => {
      await expect(stackCommand(["merge"])).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
      expect(mockedGhRaw).not.toHaveBeenCalled();
    });

    it("forwards --yes with method and target", async () => {
      mockedGhRaw.mockResolvedValue(ghStderr("✓ merged 2 pull requests\n"));

      const result = await stackCommand(["merge", "42", "--yes", "--squash"]);

      expect(mockedGhRaw).toHaveBeenCalledWith([
        "stack",
        "merge",
        "42",
        "--yes",
        "--squash",
      ]);
      expect(result).toContain("merged 2 pull requests");
    });

    it("forwards -y verbatim (gh stack merge accepts it natively)", async () => {
      await stackCommand(["merge", "-y"]);

      expect(mockedGhRaw).toHaveBeenCalledWith(["stack", "merge", "-y"]);
    });
  });

  describe("checkout", () => {
    it("requires a target (no-arg checkout is an interactive picker)", async () => {
      await expect(stackCommand(["checkout"])).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
      expect(mockedGhRaw).not.toHaveBeenCalled();
    });

    it("forwards the target verbatim", async () => {
      await stackCommand(["checkout", "42"]);

      expect(mockedGhRaw).toHaveBeenCalledWith(["stack", "checkout", "42"]);
    });
  });

  describe("pass-through subcommands", () => {
    it.each([
      [["push", "--remote", "origin"]],
      [["sync", "--prune"]],
      [["rebase", "--continue"]],
      [["link", "feat-a", "feat-b"]],
      [["unstack", "--local"]],
      [["delete", "7"]],
      [["up", "2"]],
      [["down"]],
      [["top"]],
      [["bottom"]],
      [["trunk"]],
    ])("forwards %j verbatim", async (args: string[]) => {
      await stackCommand(args);

      expect(mockedGhRaw).toHaveBeenCalledWith(["stack", ...args]);
    });

    it("reports ok when gh produces no output at all", async () => {
      const result = await stackCommand(["push"]);

      expect(result).toContain("push: ok");
    });

    it("surfaces gh-stack's stderr result, which is where it writes it", async () => {
      mockedGhRaw.mockResolvedValue(ghStderr("✓ pushed 3 branches\n"));

      const result = await stackCommand(["push"]);

      expect(result).toContain("✓ pushed 3 branches");
      expect(result).not.toContain("push: ok");
    });

    it("includes stdout as well when gh-stack writes to both streams", async () => {
      mockedGhRaw.mockResolvedValue({
        stdout: "https://github.com/o/r/pull/1\n",
        stderr: "✓ created 1 pull request\n",
        exitCode: 0,
      });

      const result = await stackCommand(["submit"]);

      expect(result).toContain("https://github.com/o/r/pull/1");
      expect(result).toContain("✓ created 1 pull request");
    });

    it("maps a non-zero exit to an AxiError instead of returning stderr", async () => {
      mockedGhRaw.mockResolvedValue({
        stdout: "",
        stderr: 'unknown command "stack" for "gh"\n',
        exitCode: 1,
      });

      await expect(stackCommand(["push"])).rejects.toMatchObject({
        code: "EXTENSION_NOT_INSTALLED",
      });
    });
  });
});
