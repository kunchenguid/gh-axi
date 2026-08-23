import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import { DESCRIPTION, TOP_HELP } from "../src/cli.js";
import {
  createSkillMarkdown,
  HERMES_CATEGORY,
  HERMES_TAGS,
  MAX_SKILL_MARKDOWN_CHARS,
  SKILL_AUTHOR,
  SKILL_DESCRIPTION,
} from "../src/skill.js";

function parseFrontmatter(markdown: string): Record<string, unknown> {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    throw new Error("Missing frontmatter");
  }
  return parse(match[1], { strict: true }) as Record<string, unknown>;
}

function skillBody(markdown: string): string {
  const end = markdown.indexOf("\n---\n", 3);
  if (end < 0) {
    throw new Error("Missing frontmatter closer");
  }
  return markdown.slice(end + 5);
}

describe("createSkillMarkdown", () => {
  it("matches the committed skills/gh-axi/SKILL.md", () => {
    const committed = readFileSync(
      new URL("../skills/gh-axi/SKILL.md", import.meta.url),
      "utf8",
    );
    expect(committed).toBe(createSkillMarkdown());
  });

  it("starts with valid YAML frontmatter and is not user-invocable", () => {
    const markdown = createSkillMarkdown();
    const frontmatter = parseFrontmatter(markdown);
    expect(frontmatter).toEqual({
      name: "gh-axi",
      description: SKILL_DESCRIPTION,
      "user-invocable": false,
      author: SKILL_AUTHOR,
      metadata: {
        hermes: {
          tags: HERMES_TAGS,
          category: HERMES_CATEGORY,
        },
      },
    });
    expect(markdown).not.toContain("$ARGUMENTS");
    expect(markdown).not.toContain("argument-hint:");
  });

  it("carries Hermes Agent metadata without env-var requirements", () => {
    const frontmatter = parseFrontmatter(createSkillMarkdown());
    const hermes = (frontmatter.metadata as { hermes: Record<string, unknown> })
      .hermes;
    expect(hermes.tags).toEqual([
      "github",
      "git",
      "ci",
      "pull-requests",
      "releases",
      "projects",
    ]);
    expect(hermes.category).toBe("devops");
    // gh-axi authenticates via the gh CLI, not an API-key env var.
    expect(frontmatter).not.toHaveProperty("required_environment_variables");
  });

  it("stays a short stub that defers to the CLI", () => {
    const markdown = createSkillMarkdown();
    const body = skillBody(markdown);
    expect(markdown.length).toBeLessThanOrEqual(MAX_SKILL_MARKDOWN_CHARS);
    expect(body).toContain(DESCRIPTION);
    expect(body).toMatch(/whenever a task touches GitHub/i);
    expect(body).toContain("npx -y gh-axi");
    expect(body).toContain("npx -y gh-axi --help");
    expect(body).toContain("npx -y gh-axi <command> --help");
    expect(body).toMatch(/stale/i);
    expect(body).toMatch(
      /- `npx -y gh-axi <command> --help` for per-command usage\n$/,
    );
  });

  it("does not bake CLI-owned guidance into the skill", () => {
    const markdown = createSkillMarkdown();
    const body = skillBody(markdown);
    expect(body).not.toMatch(/^## Commands/m);
    expect(body).not.toMatch(/^## Tips/m);
    expect(body).not.toMatch(/^## Workflow/m);
    expect(body).not.toContain("commands[");
    expect(body).not.toContain(TOP_HELP.trim());
  });
});
