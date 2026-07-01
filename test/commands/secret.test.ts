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
import { secretCommand, SECRET_HELP } from "../../src/commands/secret.js";
import { AxiError } from "../../src/errors.js";

const mockedGhJson = vi.mocked(ghJson);
const mockedGhExec = vi.mocked(ghExec);
const mockedGhExecWithStdin = vi.mocked(ghExecWithStdin);
const mockedResolveValue = vi.mocked(resolveValue);

describe("secretCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("router", () => {
    it("returns help when --help is passed", async () => {
      const result = await secretCommand(["--help"]);
      expect(result).toBe(SECRET_HELP);
    });

    it("returns help when no subcommand is given", async () => {
      const result = await secretCommand([]);
      expect(result).toBe(SECRET_HELP);
    });

    it("returns error for unknown subcommand", async () => {
      const result = await secretCommand(["unknown"]);
      expect(result).toContain("Unknown subcommand: unknown");
    });
  });

  describe("list", () => {
    it("returns secret names without values", async () => {
      mockedGhJson.mockResolvedValue([
        { name: "API_KEY", updatedAt: "2024-01-01T00:00:00Z" },
        { name: "DB_PASSWORD", updatedAt: "2024-01-02T00:00:00Z" },
      ]);

      const result = await secretCommand(["list"]);

      expect(result).toContain("API_KEY");
      expect(result).toContain("DB_PASSWORD");
      expect(result).toContain("count: 2");
      expect(mockedGhJson).toHaveBeenCalledWith(
        ["secret", "list", "--json", "name,updatedAt"],
        undefined,
      );
    });

    it("never requests or renders a value field", async () => {
      mockedGhJson.mockResolvedValue([
        { name: "API_KEY", updatedAt: "2024-01-01T00:00:00Z" },
      ]);

      await secretCommand(["list"]);

      const [ghArgs] = mockedGhJson.mock.calls[0];
      expect(ghArgs).not.toContain("value");
      expect(ghArgs.join(" ")).not.toMatch(/\bvalue\b/);
    });
  });

  describe("set", () => {
    it("sets a secret from stdin-only value resolution and writes it via stdin, not argv", async () => {
      mockedResolveValue.mockResolvedValue("super-secret");
      mockedGhExecWithStdin.mockResolvedValue("");

      const result = await secretCommand(["set", "API_KEY"]);

      expect(result).toContain("set");
      expect(result).toContain("ok");
      expect(result).toContain("API_KEY");
      expect(result).not.toContain("super-secret");
      expect(mockedResolveValue).toHaveBeenCalledWith(undefined, "secret");
      expect(mockedGhExecWithStdin).toHaveBeenCalledWith(
        ["secret", "set", "API_KEY"],
        "super-secret",
        undefined,
      );
    });

    it.each([
      ["--body", "super-secret"],
      ["--body=super-secret"],
      ["-b", "super-secret"],
      ["-b=super-secret"],
    ])("rejects unsupported secret body flag form %s", async (...flagArgs) => {
      await expect(
        secretCommand(["set", "API_KEY", ...flagArgs]),
      ).rejects.toThrow("--body/-b is not accepted");

      expect(mockedResolveValue).not.toHaveBeenCalled();
      expect(mockedGhExecWithStdin).not.toHaveBeenCalled();
    });

    it("throws when secret name is missing", async () => {
      await expect(secretCommand(["set"])).rejects.toThrow(AxiError);
      expect(mockedResolveValue).not.toHaveBeenCalled();
    });

    it("propagates errors from value resolution (e.g. missing stdin)", async () => {
      mockedResolveValue.mockRejectedValue(
        new AxiError(
          "secret value is required: pipe the value via stdin",
          "VALIDATION_ERROR",
        ),
      );

      await expect(secretCommand(["set", "API_KEY"])).rejects.toThrow(AxiError);
      expect(mockedGhExecWithStdin).not.toHaveBeenCalled();
    });
  });

  describe("delete", () => {
    it("deletes a secret by name", async () => {
      mockedGhExec.mockResolvedValue("");

      const result = await secretCommand(["delete", "API_KEY"]);

      expect(result).toContain("delete");
      expect(result).toContain("ok");
      expect(result).toContain("API_KEY");
      expect(mockedGhExec).toHaveBeenCalledWith(
        ["secret", "delete", "API_KEY"],
        undefined,
      );
    });

    it("throws when secret name is missing", async () => {
      await expect(secretCommand(["delete"])).rejects.toThrow(AxiError);
    });
  });
});
