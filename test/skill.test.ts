import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import {
  createSkillMarkdown,
  extractCommandsBlock,
  HERMES_CATEGORY,
  HERMES_TAGS,
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
    ]);
    expect(hermes.category).toBe("devops");
    // gh-axi authenticates via the gh CLI, not an API-key env var.
    expect(frontmatter).not.toHaveProperty("required_environment_variables");
  });

  it("teaches npx invocation instead of assuming a global install", () => {
    const markdown = createSkillMarkdown();
    expect(markdown).toContain("npx -y gh-axi");
  });

  it("documents the gh prerequisite", () => {
    const markdown = createSkillMarkdown();
    expect(markdown).toContain("gh auth login");
  });
});

describe("extractCommandsBlock", () => {
  it("pulls the commands list from the top-level help", () => {
    const block = extractCommandsBlock();
    expect(block).toMatch(/^commands\[\d+\]:\n/);
    expect(block).toContain("issue");
    expect(block).toContain("setup");
  });
});
