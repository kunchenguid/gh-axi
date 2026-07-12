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

    it("produces exact repo-scoped argv without --env", async () => {
      mockedGhJson.mockResolvedValue([]);

      await secretCommand(["list"]);

      expect(mockedGhJson).toHaveBeenCalledWith(
        ["secret", "list", "--json", "name,updatedAt"],
        undefined,
      );
    });

    it.each([
      ["--env", "production"],
      ["-e", "production"],
      ["--env=production"],
      ["-e=production"],
    ])(
      "forwards environment scope to upstream argv for %s",
      async (...flag) => {
        mockedGhJson.mockResolvedValue([]);

        await secretCommand(["list", ...flag]);

        expect(mockedGhJson).toHaveBeenCalledWith(
          ["secret", "list", "--json", "name,updatedAt", "--env", "production"],
          undefined,
        );
      },
    );
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
      ["--env", "production"],
      ["-e", "production"],
      ["--env=production"],
      ["-e=production"],
    ])(
      "forwards environment scope to upstream argv for %s while keeping the value on stdin only",
      async (...flag) => {
        mockedResolveValue.mockResolvedValue("super-secret");
        mockedGhExecWithStdin.mockResolvedValue("");

        const result = await secretCommand(["set", "API_KEY", ...flag]);

        // The scoped value is passed as the stdin argument, never in argv.
        expect(mockedGhExecWithStdin).toHaveBeenCalledWith(
          ["secret", "set", "API_KEY", "--env", "production"],
          "super-secret",
          undefined,
        );
        const [spawnedArgs, stdinValue] = mockedGhExecWithStdin.mock.calls[0];
        expect(spawnedArgs).not.toContain("super-secret");
        expect(spawnedArgs.join(" ")).not.toContain("super-secret");
        expect(stdinValue).toBe("super-secret");
        // The secret value never appears in the rendered command output either.
        expect(result).not.toContain("super-secret");
        expect(result).toContain("API_KEY");
      },
    );

    it("accepts the environment flag before the secret name", async () => {
      mockedResolveValue.mockResolvedValue("super-secret");
      mockedGhExecWithStdin.mockResolvedValue("");

      await secretCommand(["set", "--env", "production", "API_KEY"]);

      expect(mockedGhExecWithStdin).toHaveBeenCalledWith(
        ["secret", "set", "API_KEY", "--env", "production"],
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

    it.each([
      ["--env", "production"],
      ["-e", "production"],
      ["--env=production"],
      ["-e=production"],
    ])(
      "forwards environment scope to upstream argv for %s",
      async (...flag) => {
        mockedGhExec.mockResolvedValue("");

        await secretCommand(["delete", "API_KEY", ...flag]);

        expect(mockedGhExec).toHaveBeenCalledWith(
          ["secret", "delete", "API_KEY", "--env", "production"],
          undefined,
        );
      },
    );

    it("throws when secret name is missing", async () => {
      await expect(secretCommand(["delete"])).rejects.toThrow(AxiError);
    });
  });

  describe("scope flag validation", () => {
    it.each([
      ["list", ["list", "--org", "acme"]],
      ["set", ["set", "API_KEY", "--org", "acme"]],
      ["delete", ["delete", "API_KEY", "--org=acme"]],
    ])(
      "rejects the unsupported --org scope for %s instead of silently ignoring it",
      async (_sub, args) => {
        await expect(secretCommand(args)).rejects.toThrow(
          /only repository scope and --env/,
        );

        expect(mockedGhJson).not.toHaveBeenCalled();
        expect(mockedGhExec).not.toHaveBeenCalled();
        expect(mockedResolveValue).not.toHaveBeenCalled();
        expect(mockedGhExecWithStdin).not.toHaveBeenCalled();
      },
    );

    it.each([
      ["--user boolean scope", ["list", "--user"]],
      ["-u boolean scope", ["delete", "API_KEY", "-u"]],
      ["--app value scope", ["list", "--app", "codespaces"]],
      ["-a value scope", ["delete", "API_KEY", "-a", "actions"]],
    ])("rejects the unsupported %s", async (_label, args) => {
      await expect(secretCommand(args)).rejects.toThrow(
        /only repository scope and --env/,
      );

      expect(mockedGhJson).not.toHaveBeenCalled();
      expect(mockedGhExec).not.toHaveBeenCalled();
    });

    it("rejects --env-file so it cannot bypass the stdin-only value channel", async () => {
      await expect(
        secretCommand(["set", "API_KEY", "--env-file", "secrets.env"]),
      ).rejects.toThrow(/--env-file is not supported/);

      expect(mockedResolveValue).not.toHaveBeenCalled();
      expect(mockedGhExecWithStdin).not.toHaveBeenCalled();
    });

    it.each([
      ["list", ["list", "--env"]],
      ["set", ["set", "API_KEY", "--env"]],
      ["delete", ["delete", "API_KEY", "--env"]],
      ["empty long space form", ["list", "--env", ""]],
      ["empty short space form", ["list", "-e", ""]],
      ["empty equals form", ["list", "--env="]],
      ["value that looks like a flag", ["list", "--env", "--org"]],
    ])(
      "rejects a malformed --env with no environment name (%s)",
      async (_label, args) => {
        await expect(secretCommand(args)).rejects.toThrow(
          /--env requires an environment name/,
        );

        expect(mockedGhJson).not.toHaveBeenCalled();
        expect(mockedGhExec).not.toHaveBeenCalled();
        expect(mockedResolveValue).not.toHaveBeenCalled();
        expect(mockedGhExecWithStdin).not.toHaveBeenCalled();
      },
    );

    it("rejects conflicting --env flags rather than picking one", async () => {
      await expect(
        secretCommand(["list", "--env", "staging", "--env", "production"]),
      ).rejects.toThrow(/conflicting --env flags/);

      expect(mockedGhJson).not.toHaveBeenCalled();
    });

    it("rejects an unknown flag instead of dropping it silently", async () => {
      await expect(
        secretCommand(["list", "--visibility", "all"]),
      ).rejects.toThrow(/unknown flag for gh-axi secret list: --visibility/);

      expect(mockedGhJson).not.toHaveBeenCalled();
    });

    it("never echoes an attached =value from an unknown flag into the error", async () => {
      let message = "";
      try {
        await secretCommand(["set", "API_KEY", "--token=super-secret"]);
      } catch (err) {
        message = (err as Error).message;
      }

      expect(message).toContain("unknown flag");
      expect(message).toContain("--token");
      expect(message).not.toContain("super-secret");
      expect(mockedResolveValue).not.toHaveBeenCalled();
      expect(mockedGhExecWithStdin).not.toHaveBeenCalled();
    });
  });
});
