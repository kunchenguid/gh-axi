import { describe, it, expect } from "vitest";
import { ISSUE_FLAGS, ISSUE_HELP } from "../src/commands/issue.js";
import { PR_FLAGS, PR_HELP, prCommand } from "../src/commands/pr.js";
import { RUN_FLAGS, RUN_HELP } from "../src/commands/run.js";
import { WORKFLOW_FLAGS, WORKFLOW_HELP } from "../src/commands/workflow.js";
import { RELEASE_FLAGS, RELEASE_HELP } from "../src/commands/release.js";
import { REPO_FLAGS, REPO_HELP } from "../src/commands/repo.js";
import { LABEL_FLAGS, LABEL_HELP } from "../src/commands/label.js";
import { PROJECT_FLAGS, PROJECT_HELP } from "../src/commands/project.js";
import { SECRET_HELP } from "../src/commands/secret.js";
import { VARIABLE_FLAGS, VARIABLE_HELP } from "../src/commands/variable.js";
import { SEARCH_FLAGS, SEARCH_HELP } from "../src/commands/search.js";
import { API_HELP } from "../src/commands/api.js";
import { GIST_HELP } from "../src/commands/gist.js";
import { TOP_HELP } from "../src/cli.js";

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

describe("pr merge --admin discoverability", () => {
  it("documents --admin and the privileges it uses in pr help", async () => {
    const lines = (await prCommand(["--help"])).split("\n");
    const headerIdx = lines.findIndex((l) => l.startsWith("flags{merge}:"));
    expect(headerIdx).toBeGreaterThan(-1);
    const mergeFlags = lines[headerIdx + 1];
    expect(mergeFlags).toContain("--admin");
    expect(mergeFlags).toContain(
      "use administrator privileges to bypass merge requirements",
    );
  });
});

/**
 * Parse a HELP constant's `flags{<sub>}:` sections into the text documenting
 * each subcommand.
 *
 * A section header names one subcommand and carries its flags on the indented
 * lines that follow it (`repo`'s `create` spans three lines); every
 * continuation line is indented by two spaces, so an unindented line ends the
 * section.
 */
function parseFlagSections(help: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = help.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i].match(/^flags\{([^}]+)\}:$/);
    if (!header) continue;
    let text = "";
    for (let j = i + 1; j < lines.length && lines[j].startsWith("  "); j++) {
      text += " " + lines[j];
    }
    sections.set(header[1], text);
  }
  return sections;
}

/**
 * Whether `flag` appears in help text as a whole token, so that `--log-failed`
 * does not stand in for `--log`, nor `--body-file` for `--body`.
 */
function documents(help: string, flag: string): boolean {
  const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w-])${escaped}($|[^\\w-])`).test(help);
}

/**
 * Flags a family accepts on purpose without documenting them, with the reason.
 * `--search` is listed in both list tables so the command can reject it with a
 * hint pointing at `gh-axi search` instead of the generic unknown-flag error
 * (see the comment above `ISSUE_FLAGS`); documenting it would advertise a flag
 * that always fails.
 */
const UNDOCUMENTED_ON_PURPOSE: Record<string, Record<string, string[]>> = {
  issue: { list: ["--search"] },
  pr: { list: ["--search"] },
};

/**
 * Every flag a subcommand accepts must appear in its family's help, so that
 * `--help` can be read as the whole interface. This is the counterpart to
 * `rejectUnknownFlags`: that stops a flag the CLI does not implement, this
 * stops a flag it implements without saying so.
 *
 * Covers the command families whose accepted flags live in a
 * `Record<string, readonly string[]>` table. `api`, `gist`, `secret` and
 * `stack` declare theirs differently and are not checked here.
 */
describe("every accepted flag is documented in its family's help", () => {
  const families: [string, Record<string, readonly string[]>, string][] = [
    ["issue", ISSUE_FLAGS, ISSUE_HELP],
    ["pr", PR_FLAGS, PR_HELP],
    ["run", RUN_FLAGS, RUN_HELP],
    ["workflow", WORKFLOW_FLAGS, WORKFLOW_HELP],
    ["release", RELEASE_FLAGS, RELEASE_HELP],
    ["repo", REPO_FLAGS, REPO_HELP],
    ["label", LABEL_FLAGS, LABEL_HELP],
    ["project", PROJECT_FLAGS, PROJECT_HELP],
    ["variable", VARIABLE_FLAGS, VARIABLE_HELP],
    ["search", SEARCH_FLAGS, SEARCH_HELP],
  ];

  for (const [family, flags, help] of families) {
    const sections = parseFlagSections(help);
    // `search` documents the flags every type takes once, under `common`.
    const shared = sections.get("common") ?? "";

    for (const [sub, accepted] of Object.entries(flags)) {
      if (accepted.length === 0) continue;
      const exempt = UNDOCUMENTED_ON_PURPOSE[family]?.[sub] ?? [];
      const expected = accepted.filter((f) => !exempt.includes(f));
      if (expected.length === 0) continue;

      it(`${family} ${sub}`, () => {
        const documented = (sections.get(sub) ?? "") + " " + shared;
        expect(documented.trim()).not.toBe("");
        const missing = expected.filter((f) => !documents(documented, f));
        expect(missing, `undocumented in flags{${sub}}`).toEqual([]);
      });
    }
  }
});
