import { describe, it, expect } from "vitest";
import { ISSUE_FLAGS, ISSUE_HELP } from "../src/commands/issue.js";
import { MR_FLAGS, MR_HELP } from "../src/commands/mr.js";
import { REPO_FLAGS, REPO_HELP } from "../src/commands/repo.js";
import { API_HELP } from "../src/commands/api.js";
import { TOP_HELP } from "../src/cli.js";

/**
 * Every HELP constant must contain an "examples:" section with at least 2
 * concrete usage examples that start with "glab-axi".
 */
function assertHelpHasExamples(name: string, help: string) {
  describe(`${name}`, () => {
    it("contains an examples: section", () => {
      expect(help).toContain("examples:");
    });

    it('has at least 2 examples starting with "glab-axi"', () => {
      const examplesSection = help.slice(help.indexOf("examples:"));
      const exampleLines = examplesSection
        .split("\n")
        .filter((line) => line.trim().startsWith("glab-axi"));
      expect(exampleLines.length).toBeGreaterThanOrEqual(2);
    });

    it("examples are indented with 2 spaces", () => {
      const examplesSection = help.slice(help.indexOf("examples:"));
      const exampleLines = examplesSection
        .split("\n")
        .filter((line) => line.trim().startsWith("glab-axi"));
      for (const line of exampleLines) {
        expect(line).toMatch(/^ {2}glab-axi/);
      }
    });
  });
}

describe("Help output includes examples for every command family", () => {
  assertHelpHasExamples("TOP_HELP", TOP_HELP);
  assertHelpHasExamples("MR_HELP", MR_HELP);
  assertHelpHasExamples("ISSUE_HELP", ISSUE_HELP);
  assertHelpHasExamples("REPO_HELP", REPO_HELP);
  assertHelpHasExamples("API_HELP", API_HELP);
});

describe("TOP_HELP declares the command index and global flags", () => {
  it("names the dashboard and every command", () => {
    expect(TOP_HELP).toContain("commands[6]:");
    expect(TOP_HELP).toContain("(none)=dashboard, mr, issue, repo, api, setup");
  });

  it("documents -R/--repo as an after-command flag with the full-path shape", () => {
    expect(TOP_HELP).toContain("-R/--repo <FULL/PATH> (after command)");
  });

  it("documents --hostname and the GITLAB_HOST env var", () => {
    expect(TOP_HELP).toContain("--hostname <host> (after command) or GITLAB_HOST env");
  });

  it("documents GLAB_BIN as the binary override", () => {
    expect(TOP_HELP).toContain("GLAB_BIN");
  });
});

/**
 * Parse a HELP constant's `flags{<sub>}:` sections into the text documenting
 * each subcommand. A section header names one subcommand and carries its flags
 * on the indented lines that follow it; every continuation line is indented by
 * two spaces, so an unindented line ends the section.
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
 * Whether `flag` appears in help text as a whole token, so that
 * `--description-file` does not stand in for `--description`.
 */
function documents(help: string, flag: string): boolean {
  const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w-])${escaped}($|[^\\w-])`).test(help);
}

/**
 * Every flag a subcommand accepts must appear in its family's help, so that
 * `--help` can be read as the whole interface. This is the counterpart to
 * `rejectUnknownFlags`: that stops a flag the CLI does not implement, this
 * stops a flag it implements without saying so.
 */
describe("every accepted flag is documented in its family's help", () => {
  const families: [string, Record<string, readonly string[]>, string][] = [
    ["mr", MR_FLAGS, MR_HELP],
    ["issue", ISSUE_FLAGS, ISSUE_HELP],
    ["repo", REPO_FLAGS, REPO_HELP],
  ];

  for (const [family, flags, help] of families) {
    const sections = parseFlagSections(help);

    for (const [sub, accepted] of Object.entries(flags)) {
      if (accepted.length === 0) continue;

      it(`${family} ${sub}`, () => {
        const documented = sections.get(sub) ?? "";
        expect(documented.trim()).not.toBe("");
        const missing = accepted.filter((f) => !documents(documented, f));
        expect(missing, `undocumented in flags{${sub}}`).toEqual([]);
      });
    }
  }
});

describe("MR_HELP subcommands", () => {
  it("declares exactly 6 subcommands", () => {
    expect(MR_HELP).toContain("subcommands[6]:");
  });

  it("names all six subcommands", () => {
    const lines = MR_HELP.split("\n");
    const headerIdx = lines.findIndex((l) => l.includes("subcommands[6]:"));
    expect(headerIdx).toBeGreaterThan(-1);
    const namesCombined = lines.slice(headerIdx, headerIdx + 2).join(" ");
    for (const name of ["list", "view", "create", "merge", "close", "reopen"]) {
      expect(namesCombined).toContain(name);
    }
  });
});

describe("glab-specific discoverability", () => {
  it("documents that mr merge merges immediately unless --auto is given", () => {
    expect(MR_HELP).toContain("--auto");
  });

  it("documents --description-file in body-accepting command help", () => {
    expect(MR_HELP).toContain("--description-file <path>");
    expect(ISSUE_HELP).toContain("--description-file <path>");
  });

  it("documents nested project paths in repo help", () => {
    expect(REPO_HELP).toContain("group/subgroup/project");
  });
});
