import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/gh.js", () => ({
  ghJson: vi.fn(),
  ghExec: vi.fn(),
  ghRaw: vi.fn(),
}));

import { ghJson, ghExec } from "../../src/gh.js";
import { releaseCommand, RELEASE_HELP } from "../../src/commands/release.js";
import { AxiError } from "../../src/errors.js";
import type { RepoContext } from "../../src/context.js";

const mockedGhJson = vi.mocked(ghJson);
const mockedGhExec = vi.mocked(ghExec);

const ctx: RepoContext = {
  owner: "octo",
  name: "repo",
  nwo: "octo/repo",
  source: "flag",
};

describe("releaseCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("router", () => {
    it("returns help when --help is passed", async () => {
      const result = await releaseCommand(["--help"]);
      expect(result).toBe(RELEASE_HELP);
    });

    it("returns help when no subcommand is given", async () => {
      const result = await releaseCommand([]);
      expect(result).toBe(RELEASE_HELP);
    });

    it("returns error for unknown subcommand", async () => {
      const result = await releaseCommand(["unknown"]);
      expect(result).toContain("Unknown subcommand: unknown");
    });
  });

  describe("list", () => {
    it("returns release list", async () => {
      mockedGhJson.mockResolvedValue([
        {
          tagName: "v1.0.0",
          name: "Release 1.0",
          isDraft: false,
          isPrerelease: false,
          publishedAt: "2024-01-01T00:00:00Z",
        },
        {
          tagName: "v0.9.0",
          name: "Beta",
          isDraft: false,
          isPrerelease: true,
          publishedAt: "2023-12-01T00:00:00Z",
        },
      ]);

      const result = await releaseCommand(["list"], ctx);

      expect(result).toContain("count: 2");
      expect(result).toContain("v1.0.0");
      expect(result).toContain("v0.9.0");
    });
  });

  describe("view", () => {
    it("requires tag", async () => {
      await expect(releaseCommand(["view"], ctx)).rejects.toThrow(AxiError);
    });

    it("returns release detail when tag is provided", async () => {
      mockedGhJson.mockResolvedValue({
        tagName: "v1.0.0",
        name: "Release 1.0",
        publishedAt: "2024-01-01T00:00:00Z",
        author: { login: "alice" },
        body: "Release notes here",
      });

      const result = await releaseCommand(["view", "v1.0.0"], ctx);

      expect(result).toContain("v1.0.0");
      expect(result).toContain("Release 1.0");
      expect(result).toContain("alice");
    });

    it("omits help suggestions from detail view", async () => {
      mockedGhJson.mockResolvedValue({
        tagName: "v1.0.0",
        name: "Release 1.0",
        publishedAt: "2024-01-01T00:00:00Z",
        author: { login: "alice" },
        body: "notes",
      });
      const result = await releaseCommand(["view", "v1.0.0"], ctx);
      expect(result).not.toMatch(/^help\[/m);
    });
  });

  describe("create", () => {
    beforeEach(() => {
      mockedGhExec.mockResolvedValue("");
    });

    it("does not treat space-form valued flag values as asset files", async () => {
      await releaseCommand(
        [
          "create",
          "v1.0.0",
          "--target",
          "main",
          "--title",
          "HomeMux 0.1.0 (TestFlight)",
          "--notes",
          "hello notes",
        ],
        ctx,
      );

      expect(mockedGhExec).toHaveBeenCalledWith(
        [
          "release",
          "create",
          "v1.0.0",
          "--title",
          "HomeMux 0.1.0 (TestFlight)",
          "--notes",
          "hello notes",
          "--target",
          "main",
        ],
        ctx,
      );
    });

    it("accepts equals-form valued flags", async () => {
      await releaseCommand(
        [
          "create",
          "v1.0.0",
          "--target=abc123",
          "--title=HomeMux 0.1.0 (TestFlight)",
          "--notes=hello notes",
        ],
        ctx,
      );

      expect(mockedGhExec).toHaveBeenCalledWith(
        [
          "release",
          "create",
          "v1.0.0",
          "--title",
          "HomeMux 0.1.0 (TestFlight)",
          "--notes",
          "hello notes",
          "--target",
          "abc123",
        ],
        ctx,
      );
    });

    it("keeps trailing asset files positional after valued flags are consumed", async () => {
      await releaseCommand(
        [
          "create",
          "v1.0.0",
          "--target",
          "main",
          "--title",
          "Release title",
          "dist/app.zip",
        ],
        ctx,
      );

      expect(mockedGhExec).toHaveBeenCalledWith(
        [
          "release",
          "create",
          "v1.0.0",
          "--title",
          "Release title",
          "--target",
          "main",
          "dist/app.zip",
        ],
        ctx,
      );
    });

    it("consumes all supported valued release-create flags before assets", async () => {
      await releaseCommand(
        [
          "create",
          "v1.0.0",
          "--notes-file",
          "notes.md",
          "--discussion-category=Announcements",
          "--notes-start-tag",
          "v0.9.0",
          "dist/app.zip",
        ],
        ctx,
      );

      expect(mockedGhExec).toHaveBeenCalledWith(
        [
          "release",
          "create",
          "v1.0.0",
          "--notes-file",
          "notes.md",
          "--discussion-category",
          "Announcements",
          "--notes-start-tag",
          "v0.9.0",
          "dist/app.zip",
        ],
        ctx,
      );
    });

    it("forwards latest equals-form values", async () => {
      await releaseCommand(["create", "v1.0.0", "--latest=false"], ctx);

      expect(mockedGhExec).toHaveBeenCalledWith(
        ["release", "create", "v1.0.0", "--latest=false"],
        ctx,
      );
    });

    it("threads repo context through create", async () => {
      await releaseCommand(["create", "v1.0.0", "--target", "main"], ctx);

      expect(mockedGhExec).toHaveBeenCalledWith(expect.any(Array), ctx);
    });
  });

  describe("repo context threading", () => {
    beforeEach(() => {
      mockedGhJson.mockImplementation(async (args) => {
        if (args[0] === "release" && args[1] === "list") return [];
        return { tagName: "v1.0.0" };
      });
      mockedGhExec.mockResolvedValue("");
    });

    it.each([
      ["list", ["list"]],
      ["view", ["view", "v1.0.0"]],
      ["edit", ["edit", "v1.0.0", "--title", "New title"]],
      ["delete", ["delete", "v1.0.0"]],
      ["download", ["download", "v1.0.0", "--pattern", "*.zip"]],
      ["upload", ["upload", "v1.0.0", "dist/app.zip"]],
    ])("passes ctx to gh for release %s", async (_name, args) => {
      await releaseCommand(args, ctx);

      for (const call of mockedGhJson.mock.calls) {
        expect(call[1]).toBe(ctx);
      }
      for (const call of mockedGhExec.mock.calls) {
        expect(call[1]).toBe(ctx);
      }
    });
  });
});
