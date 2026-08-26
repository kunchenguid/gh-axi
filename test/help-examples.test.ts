import { describe, it, expect } from "vitest";
import { ISSUE_HELP } from "../src/commands/issue.js";
import { PR_HELP } from "../src/commands/pr.js";
import { RUN_HELP } from "../src/commands/run.js";
import { WORKFLOW_HELP } from "../src/commands/workflow.js";
import { RELEASE_HELP } from "../src/commands/release.js";
import { REPO_HELP } from "../src/commands/repo.js";
import { LABEL_HELP } from "../src/commands/label.js";
import { PROJECT_HELP } from "../src/commands/project.js";
import { SECRET_HELP } from "../src/commands/secret.js";
import { VARIABLE_HELP } from "../src/commands/variable.js";
import { SEARCH_HELP } from "../src/commands/search.js";
import { API_HELP } from "../src/commands/api.js";
import { GIST_HELP } from "../src/commands/gist.js";
import { TOP_HELP } from "../src/cli.js";
import { HYGIENE_HELP } from "../src/commands/hygiene.js";

/**
 * Every HELP constant must contain an "examples:" section with at least 2
 * concrete usage examples that start with "gh-axi".
 */
function assertHelpHasExamples(name: string, help: string) {
  describe(`${name}`, () => {
    it("contains an examples: section", () => {
      expect(help).toContain("examples:");
    });

    it('has at least 2 examples starting with "gh-axi"', () => {
      const examplesSection = help.slice(help.indexOf("examples:"));
      const exampleLines = examplesSection
        .split("\n")
        .filter((line) => line.trim().startsWith("gh-axi"));
      expect(exampleLines.length).toBeGreaterThanOrEqual(2);
    });

    it("examples are indented with 2 spaces", () => {
      const examplesSection = help.slice(help.indexOf("examples:"));
      const exampleLines = examplesSection
        .split("\n")
        .filter((line) => line.trim().startsWith("gh-axi"));
      for (const line of exampleLines) {
        expect(line).toMatch(/^ {2}gh-axi/);
      }
    });
  });
}

describe("Help output includes examples for every command family", () => {
  assertHelpHasExamples("TOP_HELP", TOP_HELP);
  assertHelpHasExamples("ISSUE_HELP", ISSUE_HELP);
  assertHelpHasExamples("PR_HELP", PR_HELP);
  assertHelpHasExamples("RUN_HELP", RUN_HELP);
  assertHelpHasExamples("WORKFLOW_HELP", WORKFLOW_HELP);
  assertHelpHasExamples("RELEASE_HELP", RELEASE_HELP);
  assertHelpHasExamples("REPO_HELP", REPO_HELP);
  assertHelpHasExamples("LABEL_HELP", LABEL_HELP);
  assertHelpHasExamples("PROJECT_HELP", PROJECT_HELP);
  assertHelpHasExamples("SECRET_HELP", SECRET_HELP);
  assertHelpHasExamples("VARIABLE_HELP", VARIABLE_HELP);
  assertHelpHasExamples("SEARCH_HELP", SEARCH_HELP);
  assertHelpHasExamples("API_HELP", API_HELP);
  assertHelpHasExamples("GIST_HELP", GIST_HELP);
});

describe("--body-file discoverability", () => {
  it("documents --body-file in body-accepting command help", () => {
    expect(ISSUE_HELP).toContain("--body-file <path>");
    expect(PR_HELP).toContain("--body-file <path>");
    expect(RELEASE_HELP).toContain("--body-file");
  });
});

describe("dashboard hygiene discoverability", () => {
  it("documents the supported explicit hygiene command", () => {
    expect(TOP_HELP).toContain("gh-axi hygiene --fix-ignore-conflicts");
    expect(TOP_HELP).not.toContain("gh-axi --fix-ignore-conflicts");
    expect(HYGIENE_HELP).toContain("--fix-ignore-conflicts");
  });
});

describe("GIST_HELP subcommands", () => {
  // Pin the subcommand count and names so a change that adds/removes gist
  // subcommands turns this into a visible test failure rather than a silent
  // doc discrepancy. With edit + rename merged the gist family is complete at
  // seven subcommands.
  it("declares exactly 7 subcommands", () => {
    expect(GIST_HELP).toContain("subcommands[7]:");
  });

  it("names all seven subcommands: list, view, edit, rename, create, delete, clone", () => {
    // The names appear on the indented line after "subcommands[7]:".
    const lines = GIST_HELP.split("\n");
    const headerIdx = lines.findIndex((l) => l.includes("subcommands[7]:"));
    expect(headerIdx).toBeGreaterThan(-1);
    const namesCombined = lines.slice(headerIdx, headerIdx + 2).join(" ");
    expect(namesCombined).toContain("list");
    expect(namesCombined).toContain("view");
    expect(namesCombined).toContain("edit");
    expect(namesCombined).toContain("rename");
    expect(namesCombined).toContain("create");
    expect(namesCombined).toContain("delete");
    expect(namesCombined).toContain("clone");
  });
});

describe("secret --env discoverability", () => {
  it("documents the --env/-e environment scope in secret help", () => {
    expect(SECRET_HELP).toContain("--env/-e <environment>");
  });

  it("shows an env-scoped example in secret help", () => {
    expect(SECRET_HELP).toContain("--env production");
  });
});
