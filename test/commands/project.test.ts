import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/gh.js", () => ({
  ghJson: vi.fn(),
  ghExec: vi.fn(),
  ghRaw: vi.fn(),
}));

import { ghJson } from "../../src/gh.js";
import { projectCommand, PROJECT_HELP } from "../../src/commands/project.js";
import { AxiError, exitCodeForError } from "../../src/errors.js";
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

  describe("field-create", () => {
    it("returns the field and option ids and forwards repeated option lists", async () => {
      mockedGhJson.mockResolvedValue({
        id: "PVTSSF_priority",
        name: "Priority",
        type: "ProjectV2SingleSelectField",
        options: [
          { id: "opt0", name: "P0" },
          { id: "opt1", name: "P1" },
        ],
      });
      const result = await projectCommand(
        [
          "field-create",
          "3",
          "--owner",
          "my-org",
          "--name",
          "Priority",
          "--data-type",
          "SINGLE_SELECT",
          "--single-select-options",
          "P0,P1",
          "--single-select-options=P2,P3",
        ],
        ctx,
      );
      expect(mockedGhJson).toHaveBeenCalledExactlyOnceWith([
        "project",
        "field-create",
        "3",
        "--name",
        "Priority",
        "--data-type",
        "SINGLE_SELECT",
        "--format",
        "json",
        "--owner",
        "my-org",
        "--single-select-options",
        "P0,P1",
        "--single-select-options",
        "P2,P3",
      ]);
      expect(result).toContain("PVTSSF_priority");
      expect(result).toContain("P0:opt0,P1:opt1");
      expect(result).toContain("gh-axi project field-list 3 --owner my-org");
    });

    it("prefers an explicit --owner over the -R owner in the field-list suggestion", async () => {
      mockedGhJson.mockResolvedValue({ id: "PVTF_new" });
      const result = await projectCommand(
        [
          "field-create",
          "7",
          "--owner",
          "stub-owner",
          "--name",
          "N",
          "--data-type",
          "TEXT",
        ],
        ctx,
      );
      expect(result).toContain(
        "gh-axi project field-list 7 --owner stub-owner",
      );
      expect(result).not.toContain("--owner octo");
    });

    it.each(["TEXT", "DATE", "NUMBER", "text"])(
      "supports %s fields and repo-owner default",
      async (dataType) => {
        mockedGhJson.mockResolvedValue({
          id: "PVTF_new",
          name: "123",
          type: "ProjectV2Field",
        });
        const result = await projectCommand(
          ["field-create", "--name", "123", "--data-type", dataType, "3"],
          ctx,
        );
        expect(mockedGhJson).toHaveBeenCalledExactlyOnceWith([
          "project",
          "field-create",
          "3",
          "--name",
          "123",
          "--data-type",
          dataType,
          "--format",
          "json",
          "--owner",
          "octo",
        ]);
        expect(result).toContain("PVTF_new");
        expect(result).toContain("gh-axi project field-list 3 --owner octo");
      },
    );

    it("suggests field-list with the owner resolved from -R", async () => {
      mockedGhJson.mockResolvedValue({ id: "PVTF_new" });
      const result = await projectCommand(
        ["field-create", "7", "--name", "N", "--data-type", "TEXT"],
        ctx,
      );
      expect(ctx.source).toBe("flag");
      expect(result).toContain("gh-axi project field-list 7 --owner octo");
    });

    it("defaults to the authenticated owner outside a repo", async () => {
      mockedGhJson.mockResolvedValue({ id: "PVTF_new" });
      const result = await projectCommand([
        "field-create",
        "3",
        "--name=N",
        "--data-type=TEXT",
      ]);
      expect(mockedGhJson).toHaveBeenCalledWith(
        expect.arrayContaining(["--owner", "@me"]),
      );
      expect(result).toContain("gh-axi project field-list 3 --owner @me");
    });

    it.each([
      ["--name", "123", "--data-type", "TEXT"],
      ["3", "--data-type", "TEXT"],
      ["3", "--name", "N"],
      ["3", "--name", "N", "--data-type", "ITERATION"],
      ["3", "--name", "N", "--data-type", "SINGLE_SELECT"],
      ["3", "--name", "N", "--data-type", "single_select"],
      ["3", "--name", "--data-type", "TEXT"],
      ["3", "--name= ", "--data-type=TEXT"],
      ["3", "--name=N", "--data-type=TEXT", "--single-select-options"],
      ["3", "--name=N", "--data-type=TEXT", "--single-select-options="],
      ["3", "--name=N", "--data-type=TEXT", "--owner"],
      ["3", "--name=N", "--data-type=TEXT", "--unknown"],
    ])("rejects invalid arguments without calling gh: %j", async (...args) => {
      await expect(
        projectCommand(["field-create", ...args]),
      ).rejects.toBeInstanceOf(AxiError);
      expect(mockedGhJson).not.toHaveBeenCalled();
    });

    it.each(["SINGLE_SELECT", "single_select"])(
      "rejects %s without --single-select-options locally with exit 2",
      async (dataType) => {
        const error = await projectCommand([
          "field-create",
          "3",
          "--name",
          "Priority",
          "--data-type",
          dataType,
        ]).catch((e) => e);
        expect(error).toBeInstanceOf(AxiError);
        expect((error as AxiError).code).toBe("VALIDATION_ERROR");
        expect((error as AxiError).message).toContain(
          "--single-select-options",
        );
        expect(exitCodeForError(error)).toBe(2);
        expect(mockedGhJson).not.toHaveBeenCalled();
      },
    );

    it("maps a duplicate field name to a structured already-exists error", async () => {
      mockedGhJson.mockRejectedValue(
        new AxiError(
          "GraphQL: Name has already been taken (createProjectV2Field)",
          "UNKNOWN",
        ),
      );
      const error = await projectCommand(
        ["field-create", "3", "--name", "Priority", "--data-type", "TEXT"],
        ctx,
      ).catch((e) => e);
      expect(error).toBeInstanceOf(AxiError);
      expect((error as AxiError).code).toBe("VALIDATION_ERROR");
      expect((error as AxiError).message).toBe(
        'A field named "Priority" already exists',
      );
      expect(mockedGhJson).toHaveBeenCalledTimes(1);
    });

    it("does not treat a duplicate create as success", async () => {
      mockedGhJson.mockRejectedValue(
        new AxiError(
          "GraphQL: Name has already been taken (createProjectV2Field)",
          "UNKNOWN",
        ),
      );
      await expect(
        projectCommand(
          ["field-create", "3", "--name", "Priority", "--data-type", "TEXT"],
          ctx,
        ),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: 'A field named "Priority" already exists',
      });
    });

    it("does not treat a generic already-exists message as a duplicate field", async () => {
      mockedGhJson.mockRejectedValue(
        new AxiError("A field with that name already exists", "UNKNOWN"),
      );
      await expect(
        projectCommand(
          ["field-create", "3", "--name", "Priority", "--data-type", "TEXT"],
          ctx,
        ),
      ).rejects.toMatchObject({
        code: "UNKNOWN",
        message: "A field with that name already exists",
      });
    });

    it.each(["-h", "--help"])(
      "returns project help for field-create %s",
      async (flag) => {
        const result = await projectCommand(["field-create", flag]);
        expect(result).toBe(PROJECT_HELP);
        expect(mockedGhJson).not.toHaveBeenCalled();
      },
    );
  });

  describe("single-value field flags", () => {
    const cases = [
      { command: "field-create", flag: "--owner", value: "octo" },
      { command: "field-create", flag: "--name", value: "Priority" },
      { command: "field-create", flag: "--data-type", value: "TEXT" },
      { command: "field-delete", flag: "--id", value: "PVTF_old" },
    ];

    for (const { command, flag, value } of cases) {
      it.each(["separate", "equals", "mixed"])(
        `rejects repeated ${command} ${flag} in %s form before calling gh`,
        async (form) => {
          const args =
            command === "field-create"
              ? ["3", "--name=Priority", "--data-type=TEXT"].filter(
                  (arg) => !arg.startsWith(`${flag}=`),
                )
              : [];
          const first =
            form === "equals" ? [`${flag}=${value}`] : [flag, value];
          const second =
            form === "separate" ? [flag, value] : [`${flag}=${value}`];
          await expect(
            projectCommand([command, ...args, ...first, ...second], ctx),
          ).rejects.toMatchObject({
            message: `${flag} may only be specified once`,
            code: "VALIDATION_ERROR",
          });
          expect(mockedGhJson).not.toHaveBeenCalled();
        },
      );
    }
  });

  describe("field-delete", () => {
    it("deletes by global field id without owner or repo arguments", async () => {
      mockedGhJson.mockResolvedValue({ id: "PVTF_old" });
      const result = await projectCommand(
        ["field-delete", "--id", "PVTF_old"],
        ctx,
      );
      expect(mockedGhJson).toHaveBeenCalledExactlyOnceWith([
        "project",
        "field-delete",
        "--id",
        "PVTF_old",
        "--format",
        "json",
      ]);
      expect(result).toContain("deleted:");
      expect(result).toContain("id: PVTF_old");
      expect(result).toContain("status: ok");
      expect(result).not.toContain("help[");
    });

    it.each([
      [],
      ["--id"],
      ["--id="],
      ["--id= "],
      ["--id=x", "--owner=octo"],
      ["3", "--id", "x"],
      ["--id", "x", "extra"],
    ])("rejects invalid arguments: %j", async (...args) => {
      await expect(
        projectCommand(["field-delete", ...args]),
      ).rejects.toBeInstanceOf(AxiError);
      expect(mockedGhJson).not.toHaveBeenCalled();
    });

    it("rejects extra positional args with VALIDATION_ERROR", async () => {
      const error = await projectCommand([
        "field-delete",
        "3",
        "--id",
        "PVTF_old",
      ]).catch((e) => e);
      expect(error).toBeInstanceOf(AxiError);
      expect((error as AxiError).code).toBe("VALIDATION_ERROR");
      expect((error as AxiError).message).toBe("Unexpected argument: 3");
      expect(exitCodeForError(error)).toBe(2);
      expect(mockedGhJson).not.toHaveBeenCalled();
    });

    it("propagates gh failures instead of reporting success", async () => {
      mockedGhJson.mockRejectedValue(
        new AxiError("Field not found", "NOT_FOUND"),
      );
      await expect(projectCommand(["field-delete", "--id=x"])).rejects.toThrow(
        "Field not found",
      );
    });

    it.each(["-h", "--help"])(
      "returns project help for field-delete %s",
      async (flag) => {
        const result = await projectCommand(["field-delete", flag]);
        expect(result).toBe(PROJECT_HELP);
        expect(mockedGhJson).not.toHaveBeenCalled();
      },
    );
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

    it("defaults --owner to @me when no context or flag is available", async () => {
      mockedGhJson.mockResolvedValue({ projects: [], totalCount: 0 });

      await projectCommand(["list"]);

      expect(mockedGhJson).toHaveBeenCalledWith(
        expect.arrayContaining(["--owner", "@me"]),
      );
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
        id: "PVT_kwDOA1b2c84A",
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

      expect(result).toContain("PVT_kwDOA1b2c84A");
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

    it("passes @me to gh when no context or owner is available", async () => {
      mockedGhJson.mockResolvedValue({ number: 3, title: "Personal Roadmap" });

      await projectCommand(["view", "3"]);

      expect(mockedGhJson).toHaveBeenCalledWith(
        expect.arrayContaining(["--owner", "@me"]),
      );
    });
  });

  describe("item-list", () => {
    it("returns items with totalCount and surfaces custom field values", async () => {
      mockedGhJson.mockResolvedValue({
        items: [
          {
            id: "PVTI_1",
            content: {
              title: "Fix bug",
              type: "Issue",
              number: 42,
              repository: "octo/repo",
              body: "The issue body",
              url: "https://github.com/octo/repo/issues/42",
            },
            status: "In Progress",
            labels: ["bug", "urgent"],
            assignees: ["monalisa", "hubot"],
            reviewers: ["octo-team", "maintainer"],
            milestone: {
              title: "v1.0",
              dueOn: "2026-08-01",
            },
            linkedPullRequests: ["https://github.com/octo/repo/pull/5"],
            iteration: {
              title: "Sprint 1",
              startDate: "2026-07-01",
              duration: 14,
              iterationId: "ITER_1",
            },
          },
          {
            id: "PVTI_2",
            content: {
              id: "DI_1",
              title: "Draft note",
              type: "DraftIssue",
              body: "Draft body",
            },
            priority: "High",
          },
        ],
        totalCount: 2,
      });

      const result = await projectCommand(["item-list", "3"], ctx);

      expect(result).toContain("Fix bug");
      expect(result).toContain("Issue");
      expect(result).toContain("42");
      expect(result).toContain("octo/repo");
      expect(result).toContain("The issue body");
      expect(result).toContain("https://github.com/octo/repo/issues/42");
      expect(result).toContain("In Progress");
      expect(result).toContain("bug,urgent");
      expect(result).toContain("monalisa,hubot");
      expect(result).toContain("octo-team,maintainer");
      expect(result).toContain("title:v1.0,dueOn:2026-08-01");
      expect(result).toContain("https://github.com/octo/repo/pull/5");
      expect(result).toContain(
        "title:Sprint 1,startDate:2026-07-01,duration:14,iterationId:ITER_1",
      );
      expect(result).toContain("DI_1");
      expect(result).toContain("Draft note");
      expect(result).toContain("High");
      expect(result).toContain("count: 2 of 2 total");
    });

    it("does not suggest --full when truncating item bodies", async () => {
      mockedGhJson.mockResolvedValue({
        items: [
          {
            id: "PVTI_1",
            content: {
              title: "Long draft",
              type: "DraftIssue",
              body: "x".repeat(400),
            },
          },
        ],
        totalCount: 1,
      });

      const result = await projectCommand(["item-list", "3"], ctx);

      expect(result).toContain("truncated");
      expect(result).toContain("full body unavailable in project item-list");
      expect(result).not.toContain("--full");
    });

    it("passes --query through to gh", async () => {
      mockedGhJson.mockResolvedValue({ items: [], totalCount: 0 });

      await projectCommand(["item-list", "3", "--query", "status:Todo"], ctx);

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
            options: [
              { id: "PVTSSF_lADOA1b2c84A", name: "Todo" },
              { id: "PVTSSF_lADOA1b2c84B", name: "Done" },
            ],
          },
        ],
        totalCount: 1,
      });

      const result = await projectCommand(["field-list", "3"], ctx);

      expect(result).toContain("Status");
      expect(result).toContain("Todo:PVTSSF_lADOA1b2c84A");
      expect(result).toContain("Done:PVTSSF_lADOA1b2c84B");
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
      await expect(projectCommand(["item-add", "3"], ctx)).rejects.toThrow(
        AxiError,
      );
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
      await expect(projectCommand(["item-create", "3"], ctx)).rejects.toThrow(
        AxiError,
      );
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
      await expect(projectCommand(["item-archive", "3"], ctx)).rejects.toThrow(
        AxiError,
      );
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
      await expect(projectCommand(["item-delete", "3"], ctx)).rejects.toThrow(
        AxiError,
      );
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
      await expect(projectCommand(["create"], ctx)).rejects.toThrow(AxiError);
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

    it("does not parse numeric flag values as the project number", async () => {
      mockedGhJson.mockResolvedValue({ number: 3 });

      await projectCommand(["edit", "--title", "2027", "3"], ctx);

      expect(mockedGhJson).toHaveBeenCalledWith([
        "project",
        "edit",
        "3",
        "--format",
        "json",
        "--owner",
        "octo",
        "--title",
        "2027",
      ]);
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
        ["copy", "3", "--target-owner", "dest", "--title", "Copied Roadmap"],
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

    it("defaults --source-owner to @me when no context or flag is available", async () => {
      mockedGhJson.mockResolvedValue({
        number: 10,
        url: "https://github.com/users/dest/projects/10",
      });

      await projectCommand([
        "copy",
        "3",
        "--target-owner",
        "dest",
        "--title",
        "Copied Roadmap",
      ]);

      expect(mockedGhJson).toHaveBeenCalledWith(
        expect.arrayContaining(["--source-owner", "@me"]),
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

  describe("delete", () => {
    it("deletes an empty project", async () => {
      mockedGhJson
        .mockResolvedValueOnce({
          number: 7,
          title: "Empty Project",
          items: { totalCount: 0 },
        })
        .mockResolvedValueOnce({
          id: "PVT_123",
          title: "Empty Project",
        });

      const result = await projectCommand(["delete", "7"], ctx);

      expect(result).toContain("deleted");
      expect(result).toContain("Empty Project");
      expect(result).toContain("item_count: 0");
      expect(result).toContain("status: ok");
      expect(mockedGhJson).toHaveBeenNthCalledWith(1, [
        "project",
        "view",
        "7",
        "--format",
        "json",
        "--owner",
        "octo",
      ]);
      expect(mockedGhJson).toHaveBeenNthCalledWith(2, [
        "project",
        "delete",
        "7",
        "--format",
        "json",
        "--owner",
        "octo",
      ]);
      expect(result).toContain("gh-axi project list --owner octo");
    });

    it("previews title and item count before calling gh project delete", async () => {
      const events: string[] = [];
      const stderr = vi
        .spyOn(process.stderr, "write")
        .mockImplementation((chunk) => {
          events.push(`preview:${String(chunk)}`);
          return true;
        });
      mockedGhJson.mockImplementation(async (args: string[]) => {
        events.push(`gh:${args[1]}`);
        return { number: 7, title: "Empty Project", items: { totalCount: 0 } };
      });

      try {
        await projectCommand(["delete", "7"], ctx);
      } finally {
        stderr.mockRestore();
      }

      expect(events).toHaveLength(3);
      expect(events[0]).toBe("gh:view");
      expect(events[1]).toContain("preview:");
      expect(events[1]).toContain("Empty Project");
      expect(events[1]).toContain("item_count=0");
      expect(events[2]).toBe("gh:delete");
    });

    it("refuses to delete a project with items", async () => {
      mockedGhJson.mockResolvedValueOnce({
        number: 8,
        title: "Project With Items",
        items: { totalCount: 2 },
      });

      const error = await projectCommand(["delete", "8"], ctx).catch((e) => e);

      expect(error).toBeInstanceOf(AxiError);
      expect((error as AxiError).code).toBe("VALIDATION_ERROR");
      expect((error as AxiError).message).toContain("Project With Items");
      expect((error as AxiError).message).toContain("2 items");
      expect((error as AxiError).message).toContain("#8");
      expect((error as AxiError).suggestions.length).toBeGreaterThan(0);
      expect(mockedGhJson).toHaveBeenCalledTimes(1);
    });

    it("refuses to delete when the item count is missing", async () => {
      mockedGhJson.mockResolvedValueOnce({ number: 9, title: "Unknown" });

      const error = await projectCommand(["delete", "9"], ctx).catch((e) => e);

      expect(error).toBeInstanceOf(AxiError);
      expect((error as AxiError).code).toBe("VALIDATION_ERROR");
      expect(mockedGhJson).toHaveBeenCalledTimes(1);
    });

    it("defaults --owner from repo context when not explicitly given", async () => {
      mockedGhJson
        .mockResolvedValueOnce({
          number: 7,
          title: "Empty",
          items: { totalCount: 0 },
        })
        .mockResolvedValueOnce({});

      await projectCommand(["delete", "7"], ctx);

      expect(mockedGhJson).toHaveBeenCalledWith(
        expect.arrayContaining(["--owner", "octo"]),
      );
    });

    it("prefers an explicit --owner flag over repo context", async () => {
      mockedGhJson
        .mockResolvedValueOnce({
          number: 7,
          title: "Empty",
          items: { totalCount: 0 },
        })
        .mockResolvedValueOnce({});

      await projectCommand(["delete", "7", "--owner", "custom-org"], ctx);

      expect(mockedGhJson).toHaveBeenCalledWith(
        expect.arrayContaining(["--owner", "custom-org"]),
      );
    });

    it("defaults --owner to @me when no context or flag is available", async () => {
      mockedGhJson
        .mockResolvedValueOnce({
          number: 7,
          title: "Empty",
          items: { totalCount: 0 },
        })
        .mockResolvedValueOnce({});

      await projectCommand(["delete", "7"]);

      expect(mockedGhJson).toHaveBeenCalledWith(
        expect.arrayContaining(["--owner", "@me"]),
      );
    });

    it("throws when project number is missing", async () => {
      await expect(projectCommand(["delete"], ctx)).rejects.toThrow(AxiError);
    });

    it("rejects unknown flags", async () => {
      await expect(
        projectCommand(["delete", "7", "--force"], ctx),
      ).rejects.toThrow(AxiError);
    });
  });
});
