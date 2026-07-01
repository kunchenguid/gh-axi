import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/gh.js", () => ({
  ghJson: vi.fn(),
  ghExec: vi.fn(),
  ghExecWithStdin: vi.fn(),
}));

vi.mock("../../src/secretValue.js", () => ({
  resolveValue: vi.fn(),
}));

import { ghJson, ghExec, ghExecWithStdin } from "../../src/gh.js";
import { resolveValue } from "../../src/secretValue.js";
import { variableCommand, VARIABLE_HELP } from "../../src/commands/variable.js";
import { AxiError } from "../../src/errors.js";

const mockedGhJson = vi.mocked(ghJson);
const mockedGhExec = vi.mocked(ghExec);
const mockedGhExecWithStdin = vi.mocked(ghExecWithStdin);
const mockedResolveValue = vi.mocked(resolveValue);

describe("variableCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("router", () => {
    it("returns help when --help is passed", async () => {
      const result = await variableCommand(["--help"]);
      expect(result).toBe(VARIABLE_HELP);
    });

    it("returns help when no subcommand is given", async () => {
      const result = await variableCommand([]);
      expect(result).toBe(VARIABLE_HELP);
    });

    it("returns error for unknown subcommand", async () => {
      const result = await variableCommand(["unknown"]);
      expect(result).toContain("Unknown subcommand: unknown");
    });
  });

  describe("list", () => {
    it("returns variable names and values", async () => {
      mockedGhJson.mockResolvedValue([
        {
          name: "NODE_ENV",
          value: "production",
          updatedAt: "2024-01-01T00:00:00Z",
        },
      ]);

      const result = await variableCommand(["list"]);

      expect(result).toContain("NODE_ENV");
      expect(result).toContain("production");
      expect(result).toContain("count: 1");
      expect(mockedGhJson).toHaveBeenCalledWith(
        ["variable", "list", "--json", "name,value,updatedAt"],
        undefined,
      );
    });
  });

  describe("set", () => {
    it("sets a variable from a resolved value and writes it via stdin", async () => {
      mockedResolveValue.mockResolvedValue("production");
      mockedGhExecWithStdin.mockResolvedValue("");

      const result = await variableCommand([
        "set",
        "NODE_ENV",
        "--body",
        "production",
      ]);

      expect(result).toContain("set");
      expect(result).toContain("ok");
      expect(result).toContain("NODE_ENV");
      expect(mockedResolveValue).toHaveBeenCalledWith("production", "variable");
      expect(mockedGhExecWithStdin).toHaveBeenCalledWith(
        ["variable", "set", "NODE_ENV"],
        "production",
        undefined,
      );
    });

    it("throws when variable name is missing", async () => {
      await expect(variableCommand(["set"])).rejects.toThrow(AxiError);
      expect(mockedResolveValue).not.toHaveBeenCalled();
    });
  });

  describe("delete", () => {
    it("deletes a variable by name", async () => {
      mockedGhExec.mockResolvedValue("");

      const result = await variableCommand(["delete", "NODE_ENV"]);

      expect(result).toContain("delete");
      expect(result).toContain("ok");
      expect(result).toContain("NODE_ENV");
      expect(mockedGhExec).toHaveBeenCalledWith(
        ["variable", "delete", "NODE_ENV"],
        undefined,
      );
    });

    it("throws when variable name is missing", async () => {
      await expect(variableCommand(["delete"])).rejects.toThrow(AxiError);
    });
  });
});
