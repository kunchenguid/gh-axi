import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { DESCRIPTION, TOP_HELP } from "../src/cli.js";
import {
  createSkillMarkdown,
  HERMES_CATEGORY,
  HERMES_TAGS,
  MAX_SKILL_MARKDOWN_CHARS,
  SKILL_AUTHOR,
  SKILL_DESCRIPTION,
} from "../src/skill.js";

function frontmatterBlock(markdown: string): string {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    throw new Error("Missing frontmatter");
  }
  return match[1];
}

function skillBody(markdown: string): string {
  const end = markdown.indexOf("\n---\n", 3);
  if (end < 0) {
    throw new Error("Missing frontmatter closer");
  }
  return markdown.slice(end + 5);
}

describe("createSkillMarkdown", () => {
  it("matches the committed skills/glab-axi/SKILL.md", () => {
    const committed = readFileSync(
      new URL("../skills/glab-axi/SKILL.md", import.meta.url),
      "utf8",
    );
    expect(committed).toBe(createSkillMarkdown());
  });

  it("starts with valid frontmatter naming the skill", () => {
    const markdown = createSkillMarkdown();
    const fm = frontmatterBlock(markdown);
    expect(fm).toContain("name: glab-axi");
    expect(fm).toContain("user-invocable: false");
    expect(fm).toContain(`author: ${SKILL_AUTHOR}`);
    expect(fm).not.toContain("$ARGUMENTS");
    expect(fm).not.toContain("argument-hint:");
  });

  it("carries the description and Hermes metadata", () => {
    const markdown = createSkillMarkdown();
    expect(markdown).toContain(JSON.stringify(SKILL_DESCRIPTION));
    const fm = frontmatterBlock(markdown);
    expect(fm).toContain(HERMES_TAGS.join(", "));
    expect(fm).toContain(`category: ${HERMES_CATEGORY}`);
  });

  it("stays a short stub that defers to the CLI", () => {
    const markdown = createSkillMarkdown();
    const body = skillBody(markdown);
    expect(markdown.length).toBeLessThanOrEqual(MAX_SKILL_MARKDOWN_CHARS);
    expect(body).toContain(DESCRIPTION);
    expect(body).toMatch(/whenever a task touches GitLab/i);
    expect(body).toContain("`glab-axi` for a dashboard");
    expect(body).toContain("`glab-axi --help` for global flags");
    expect(body).toContain("`glab-axi <command> --help` for per-command usage");
    expect(body).toMatch(/stale/i);
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
