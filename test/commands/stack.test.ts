import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/gh.js", () => ({
  ghJson: vi.fn(),
  ghExec: vi.fn(),
}));

import { ghJson, ghExec } from "../../src/gh.js";
import { stackCommand, STACK_HELP } from "../../src/commands/stack.js";

const mockedGhJson = vi.mocked(ghJson);
const mockedGhExec = vi.mocked(ghExec);

describe("stackCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
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

    it("points interactive-only subcommands at plain gh stack", async () => {
      const result = await stackCommand(["modify"]);
      expect(result).toContain("gh stack");
      expect(mockedGhExec).not.toHaveBeenCalled();
    });
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
  });

  describe("init", () => {
    it("requires at least one branch name (no-arg init is interactive)", async () => {
      await expect(stackCommand(["init"])).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
      expect(mockedGhExec).not.toHaveBeenCalled();
    });

    it("forwards branches and --base verbatim", async () => {
      mockedGhExec.mockResolvedValue("✓ created stack\n");

      const result = await stackCommand([
        "init",
        "-b",
        "develop",
        "feat-a",
        "feat-b",
      ]);

      expect(mockedGhExec).toHaveBeenCalledWith([
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
      mockedGhExec.mockResolvedValue("");

      await stackCommand(["add", "feat-c"]);

      expect(mockedGhExec).toHaveBeenCalledWith(["stack", "add", "feat-c"]);
    });

    it("requires -m when staging with -A (editor trap)", async () => {
      await expect(stackCommand(["add", "-A"])).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
      expect(mockedGhExec).not.toHaveBeenCalled();
    });

    it("requires -m when staging with -u (editor trap)", async () => {
      await expect(stackCommand(["add", "-u"])).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
    });

    it("accepts -A with -m", async () => {
      mockedGhExec.mockResolvedValue("");

      await stackCommand(["add", "-A", "-m", "add feature", "feat-c"]);

      expect(mockedGhExec).toHaveBeenCalledWith([
        "stack",
        "add",
        "-A",
        "-m",
        "add feature",
        "feat-c",
      ]);
    });

    it("accepts bundled -Am", async () => {
      mockedGhExec.mockResolvedValue("");

      await stackCommand(["add", "-Am", "add feature"]);

      expect(mockedGhExec).toHaveBeenCalledWith([
        "stack",
        "add",
        "-Am",
        "add feature",
      ]);
    });
  });

  describe("submit", () => {
    it("appends --auto so the interactive editor never opens", async () => {
      mockedGhExec.mockResolvedValue("✓ created 2 pull requests\n");

      const result = await stackCommand(["submit"]);

      expect(mockedGhExec).toHaveBeenCalledWith(["stack", "submit", "--auto"]);
      expect(result).toContain("created 2 pull requests");
    });

    it("does not duplicate an explicit --auto", async () => {
      mockedGhExec.mockResolvedValue("");

      await stackCommand(["submit", "--auto", "--open"]);

      expect(mockedGhExec).toHaveBeenCalledWith([
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
      expect(mockedGhExec).not.toHaveBeenCalled();
    });

    it("forwards --yes with method and target", async () => {
      mockedGhExec.mockResolvedValue("✓ merged 2 pull requests\n");

      const result = await stackCommand(["merge", "42", "--yes", "--squash"]);

      expect(mockedGhExec).toHaveBeenCalledWith([
        "stack",
        "merge",
        "42",
        "--yes",
        "--squash",
      ]);
      expect(result).toContain("merged 2 pull requests");
    });

    it("normalizes -y to --yes", async () => {
      mockedGhExec.mockResolvedValue("");

      await stackCommand(["merge", "-y"]);

      expect(mockedGhExec).toHaveBeenCalledWith(["stack", "merge", "--yes"]);
    });
  });

  describe("checkout", () => {
    it("requires a target (no-arg checkout is an interactive picker)", async () => {
      await expect(stackCommand(["checkout"])).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
      expect(mockedGhExec).not.toHaveBeenCalled();
    });

    it("forwards the target verbatim", async () => {
      mockedGhExec.mockResolvedValue("");

      await stackCommand(["checkout", "42"]);

      expect(mockedGhExec).toHaveBeenCalledWith(["stack", "checkout", "42"]);
    });
  });

  describe("pass-through subcommands", () => {
    it.each([
      [["push", "--remote", "origin"]],
      [["sync", "--prune"]],
      [["rebase", "--continue"]],
      [["link", "feat-a", "feat-b"]],
      [["unstack", "--local"]],
      [["up", "2"]],
      [["down"]],
      [["top"]],
      [["bottom"]],
      [["trunk"]],
    ])("forwards %j verbatim", async (args: string[]) => {
      mockedGhExec.mockResolvedValue("");

      await stackCommand(args);

      expect(mockedGhExec).toHaveBeenCalledWith(["stack", ...args]);
    });

    it("reports ok when gh produces no stdout", async () => {
      mockedGhExec.mockResolvedValue("");

      const result = await stackCommand(["push"]);

      expect(result).toContain("push: ok");
    });

    it("passes gh stdout through when present", async () => {
      mockedGhExec.mockResolvedValue("✓ pushed 3 branches\n");

      const result = await stackCommand(["push"]);

      expect(result).toContain("✓ pushed 3 branches");
    });
  });
});
