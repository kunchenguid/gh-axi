import { DESCRIPTION } from "./cli.js";

// Trigger string Claude Code (and other agents) match against to auto-load the skill.
// Kept terse and outcome-focused so it fires on "needs GitHub" intents.
export const SKILL_DESCRIPTION =
  "Operate GitHub through the gh-axi CLI - issues, pull requests, stacked PRs, workflow runs, workflows, " +
  "releases, repositories, labels, gists, Projects (v2), Actions secrets and variables, search, and raw API access. " +
  "Use whenever a task touches GitHub: listing or filing issues, reviewing or merging PRs, managing stacked branches and PRs, " +
  "checking CI runs, triggering workflows, cutting releases, managing Projects boards, managing Actions secrets/variables, or working with gists via `gist list`, `gist view`, `gist edit`, `gist rename`, `gist create`, `gist delete`, or `gist clone`.";

export const SKILL_AUTHOR = "Kun Chen (kunchenguid)";

// Extended frontmatter read by Nous Research's Hermes Agent harness
// (https://hermes-agent.nousresearch.com/docs/user-guide/features/skills).
// Harnesses that don't know these fields (e.g. Claude Code) ignore them.
export const HERMES_TAGS = [
  "github",
  "git",
  "ci",
  "pull-requests",
  "releases",
  "projects",
];
export const HERMES_CATEGORY = "devops";

// Hard cap so a future regeneration cannot silently re-inflate the stub with
// CLI-owned instructions. Dashboard, `--help`, and per-command help are the
// source of truth.
export const MAX_SKILL_MARKDOWN_CHARS = 2500;

function yamlDoubleQuote(value: string): string {
  return JSON.stringify(value);
}

/**
 * Render the installable SKILL.md for the gh-axi skill.
 *
 * This is a discovery stub, not a copy of CLI guidance. Installed skills go
 * stale; `gh-axi` (dashboard), `gh-axi --help`, and `gh-axi <command> --help`
 * do not. Keep the body to what gh-axi is, when to reach for it, and pointers
 * at those commands.
 *
 * @returns full SKILL.md contents including YAML frontmatter
 */
export function createSkillMarkdown(): string {
  const markdown = `---
name: gh-axi
description: ${yamlDoubleQuote(SKILL_DESCRIPTION)}
user-invocable: false
author: ${SKILL_AUTHOR}
metadata:
  hermes:
    tags: [${HERMES_TAGS.join(", ")}]
    category: ${HERMES_CATEGORY}
---

# gh-axi

${DESCRIPTION}

Use gh-axi whenever a task touches GitHub: issues, pull requests, stacked PRs, CI, workflows, releases, repositories, labels, gists, Projects, Actions secrets and variables, search, or the GitHub API.

## Current guidance lives in the CLI

Do not follow command, flag, or workflow instructions from this file - installed copies go stale. Get the current source of truth from the CLI:

- \`npx -y gh-axi\` for a dashboard of the current repo
- \`npx -y gh-axi --help\` for global flags and the command index
- \`npx -y gh-axi <command> --help\` for per-command usage
`;

  if (markdown.length > MAX_SKILL_MARKDOWN_CHARS) {
    throw new Error(
      `generated SKILL.md is ${markdown.length} chars; keep it a stub under ${MAX_SKILL_MARKDOWN_CHARS} and defer guidance to the CLI`,
    );
  }

  return markdown;
}
