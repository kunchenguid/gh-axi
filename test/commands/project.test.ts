import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/gh.js", () => ({
  ghJson: vi.fn(),
  ghExec: vi.fn(),
  ghRaw: vi.fn(),
}));

import { ghJson } from "../../src/gh.js";
import { projectCommand, PROJECT_HELP } from "../../src/commands/project.js";
import { AxiError } from "../../src/errors.js";
import type { RepoContext } from "../../src/context.js";

const mockedGhJson = vi.mocked(ghJson);

const ctx: RepoContext = {
  owner: "octo",
  name: "repo",
  nwo: "octo/repo",
  source: "flag",
};

describe("projectCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("router", () => {
    it("returns help when --help is passed", async () => {
      const result = await projectCommand(["--help"]);
      expect(result).toBe(PROJECT_HELP);
    });

    it("returns help when no subcommand is given", async () => {
      const result = await projectCommand([]);
      expect(result).toBe(PROJECT_HELP);
    });

    it("returns error for unknown subcommand", async () => {
      const result = await projectCommand(["unknown"]);
      expect(result).toContain("Unknown project subcommand: unknown");
    });
  });

  describe("list", () => {
    it("returns project list with totalCount", async () => {
      mockedGhJson.mockResolvedValue({
        projects: [
          {
            number: 1,
            title: "Roadmap",
            closed: false,
            owner: { login: "octo" },
            url: "https://github.com/orgs/octo/projects/1",
          },
        ],
        totalCount: 1,
      });

      const result = await projectCommand(["list"], ctx);

      expect(result).toContain("Roadmap");
      expect(result).toContain("count: 1 of 1 total");
      expect(mockedGhJson).toHaveBeenCalledWith([
        "project",
        "list",
        "--format",
        "json",
        "--limit",
        "30",
        "--owner",
        "octo",
      ]);
    });

    it("defaults --owner from repo context when not explicitly given", async () => {
      mockedGhJson.mockResolvedValue({ projects: [], totalCount: 0 });

      await projectCommand(["list"], ctx);

      expect(mockedGhJson).toHaveBeenCalledWith(
        expect.arrayContaining(["--owner", "octo"]),
      );
    });

    it("prefers an explicit --owner flag over repo context", async () => {
      mockedGhJson.mockResolvedValue({ projects: [], totalCount: 0 });

      await projectCommand(["list", "--owner", "my-org"], ctx);

      expect(mockedGhJson).toHaveBeenCalledWith(
        expect.arrayContaining(["--owner", "my-org"]),
      );
    });

    it("omits --owner when no context or flag is available", async () => {
      mockedGhJson.mockResolvedValue({ projects: [], totalCount: 0 });

      await projectCommand(["list"]);

      const calledArgs = mockedGhJson.mock.calls[0]?.[0] as string[];
      expect(calledArgs).not.toContain("--owner");
    });

    it("passes --closed when requested", async () => {
      mockedGhJson.mockResolvedValue({ projects: [], totalCount: 0 });

      await projectCommand(["list", "--closed"], ctx);

      expect(mockedGhJson).toHaveBeenCalledWith(
        expect.arrayContaining(["--closed"]),
      );
    });

    it("reports a definitive empty state", async () => {
      mockedGhJson.mockResolvedValue({ projects: [], totalCount: 0 });

      const result = await projectCommand(["list"], ctx);

      expect(result).toContain("count: 0 of 0 total");
    });
  });

  describe("view", () => {
    it("returns project details", async () => {
      mockedGhJson.mockResolvedValue({
        number: 3,
        title: "Roadmap",
        closed: false,
        public: true,
        shortDescription: "Q1 plan",
        owner: { login: "octo" },
        items: { totalCount: 5 },
        fields: { totalCount: 4 },
        url: "https://github.com/orgs/octo/projects/3",
      });

      const result = await projectCommand(["view", "3"], ctx);

      expect(result).toContain("Roadmap");
      expect(result).toContain("open");
      expect(result).toContain("public");
      expect(mockedGhJson).toHaveBeenCalledWith([
        "project",
        "view",
        "3",
        "--format",
        "json",
        "--owner",
        "octo",
      ]);
    });

    it("throws when project number is missing", async () => {
      await expect(projectCommand(["view"], ctx)).rejects.toThrow(AxiError);
    });
  });

  describe("item-list", () => {
    it("returns items with totalCount and surfaces custom fields", async () => {
      mockedGhJson.mockResolvedValue({
        items: [
          {
            id: "PVTI_1",
            title: "Fix bug",
            type: "ISSUE",
            number: 42,
            repository: "octo/repo",
            url: "https://github.com/octo/repo/issues/42",
            Status: "In Progress",
          },
        ],
        totalCount: 1,
      });

      const result = await projectCommand(["item-list", "3"], ctx);

      expect(result).toContain("Fix bug");
      expect(result).toContain("In Progress");
      expect(result).toContain("count: 1 of 1 total");
    });

    it("passes --query through to gh", async () => {
      mockedGhJson.mockResolvedValue({ items: [], totalCount: 0 });

      await projectCommand(
        ["item-list", "3", "--query", "status:Todo"],
        ctx,
      );

      expect(mockedGhJson).toHaveBeenCalledWith(
        expect.arrayContaining(["--query", "status:Todo"]),
      );
    });
  });

  describe("field-list", () => {
    it("returns fields with options flattened", async () => {
      mockedGhJson.mockResolvedValue({
        fields: [
          {
            id: "PVTF_1",
            name: "Status",
            type: "ProjectV2SingleSelectField",
            options: [{ name: "Todo" }, { name: "Done" }],
          },
        ],
        totalCount: 1,
      });

      const result = await projectCommand(["field-list", "3"], ctx);

      expect(result).toContain("Status");
      expect(result).toContain("Todo,Done");
    });
  });

  describe("item-add", () => {
    it("adds an item by URL", async () => {
      mockedGhJson.mockResolvedValue({ id: "PVTI_2", title: "New item" });

      const result = await projectCommand(
        ["item-add", "3", "--url", "https://github.com/octo/repo/issues/12"],
        ctx,
      );

      expect(result).toContain("added");
      expect(result).toContain("PVTI_2");
      expect(mockedGhJson).toHaveBeenCalledWith(
        expect.arrayContaining([
          "item-add",
          "3",
          "--url",
          "https://github.com/octo/repo/issues/12",
        ]),
      );
    });

    it("throws when --url is missing", async () => {
      await expect(
        projectCommand(["item-add", "3"], ctx),
      ).rejects.toThrow(AxiError);
    });
  });

  describe("item-create", () => {
    it("creates a draft issue item", async () => {
      mockedGhJson.mockResolvedValue({ id: "PVTI_3", title: "Draft" });

      const result = await projectCommand(
        ["item-create", "3", "--title", "Draft", "--body", "details"],
        ctx,
      );

      expect(result).toContain("created");
      expect(mockedGhJson).toHaveBeenCalledWith(
        expect.arrayContaining(["--title", "Draft", "--body", "details"]),
      );
    });

    it("throws when --title is missing", async () => {
      await expect(
        projectCommand(["item-create", "3"], ctx),
      ).rejects.toThrow(AxiError);
    });
  });

  describe("item-edit", () => {
    it("edits an item field value", async () => {
      mockedGhJson.mockResolvedValue({ id: "PVTI_1" });

      const result = await projectCommand([
        "item-edit",
        "--id",
        "PVTI_1",
        "--field-id",
        "FIELD_1",
        "--project-id",
        "PROJ_1",
        "--text",
        "new text",
      ]);

      expect(result).toContain("edited");
      expect(mockedGhJson).toHaveBeenCalledWith([
        "project",
        "item-edit",
        "--id",
        "PVTI_1",
        "--format",
        "json",
        "--project-id",
        "PROJ_1",
        "--field-id",
        "FIELD_1",
        "--text",
        "new text",
      ]);
    });

    it("throws when --id is missing", async () => {
      await expect(
        projectCommand(["item-edit", "--field-id", "FIELD_1"]),
      ).rejects.toThrow(AxiError);
    });
  });

  describe("item-archive", () => {
    it("archives an item", async () => {
      mockedGhJson.mockResolvedValue({ id: "PVTI_1" });

      const result = await projectCommand(
        ["item-archive", "3", "--id", "PVTI_1"],
        ctx,
      );

      expect(result).toContain("archived");
    });

    it("unarchives when --undo is passed", async () => {
      mockedGhJson.mockResolvedValue({ id: "PVTI_1" });

      const result = await projectCommand(
        ["item-archive", "3", "--id", "PVTI_1", "--undo"],
        ctx,
      );

      expect(result).toContain("unarchived");
      expect(mockedGhJson).toHaveBeenCalledWith(
        expect.arrayContaining(["--undo"]),
      );
    });

    it("throws when --id is missing", async () => {
      await expect(
        projectCommand(["item-archive", "3"], ctx),
      ).rejects.toThrow(AxiError);
    });
  });

  describe("item-delete", () => {
    it("deletes an item", async () => {
      mockedGhJson.mockResolvedValue({ id: "PVTI_1" });

      const result = await projectCommand(
        ["item-delete", "3", "--id", "PVTI_1"],
        ctx,
      );

      expect(result).toContain("deleted");
    });

    it("throws when --id is missing", async () => {
      await expect(
        projectCommand(["item-delete", "3"], ctx),
      ).rejects.toThrow(AxiError);
    });
  });

  describe("create", () => {
    it("creates a project", async () => {
      mockedGhJson.mockResolvedValue({
        number: 9,
        url: "https://github.com/orgs/octo/projects/9",
      });

      const result = await projectCommand(
        ["create", "--title", "Roadmap"],
        ctx,
      );

      expect(result).toContain("created");
      expect(result).toContain("9");
      expect(mockedGhJson).toHaveBeenCalledWith(
        expect.arrayContaining(["--title", "Roadmap", "--owner", "octo"]),
      );
    });

    it("throws when --title is missing", async () => {
      await expect(projectCommand(["create"], ctx)).rejects.toThrow(
        AxiError,
      );
    });
  });

  describe("edit", () => {
    it("edits a project", async () => {
      mockedGhJson.mockResolvedValue({ number: 3 });

      const result = await projectCommand(
        ["edit", "3", "--title", "New title"],
        ctx,
      );

      expect(result).toContain("edited");
      expect(mockedGhJson).toHaveBeenCalledWith(
        expect.arrayContaining(["--title", "New title"]),
      );
    });
  });

  describe("close", () => {
    it("closes an open project", async () => {
      mockedGhJson
        .mockResolvedValueOnce({ number: 3, closed: false })
        .mockResolvedValueOnce({ number: 3, closed: true });

      const result = await projectCommand(["close", "3"], ctx);

      expect(result).toContain("closed");
      expect(result).not.toContain("already");
    });

    it("is idempotent when already closed", async () => {
      mockedGhJson.mockResolvedValueOnce({ number: 3, closed: true });

      const result = await projectCommand(["close", "3"], ctx);

      expect(result).toContain("already");
      expect(mockedGhJson).toHaveBeenCalledTimes(1);
    });

    it("reopens with --undo", async () => {
      mockedGhJson
        .mockResolvedValueOnce({ number: 3, closed: true })
        .mockResolvedValueOnce({ number: 3, closed: false });

      const result = await projectCommand(["close", "3", "--undo"], ctx);

      expect(result).toContain("reopened");
    });
  });

  describe("copy", () => {
    it("copies a project to a target owner", async () => {
      mockedGhJson.mockResolvedValue({
        number: 10,
        url: "https://github.com/orgs/dest/projects/10",
      });

      const result = await projectCommand(
        [
          "copy",
          "3",
          "--target-owner",
          "dest",
          "--title",
          "Copied Roadmap",
        ],
        ctx,
      );

      expect(result).toContain("copied");
      expect(mockedGhJson).toHaveBeenCalledWith(
        expect.arrayContaining([
          "--target-owner",
          "dest",
          "--title",
          "Copied Roadmap",
          "--source-owner",
          "octo",
        ]),
      );
    });

    it("throws when --target-owner is missing", async () => {
      await expect(
        projectCommand(["copy", "3", "--title", "Copy"], ctx),
      ).rejects.toThrow(AxiError);
    });

    it("throws when --title is missing", async () => {
      await expect(
        projectCommand(["copy", "3", "--target-owner", "dest"], ctx),
      ).rejects.toThrow(AxiError);
    });
  });
});
