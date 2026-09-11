import { DESCRIPTION } from "./cli.js";

// Trigger string Claude Code (and other agents) match against to auto-load the skill.
// Kept terse and outcome-focused so it fires on "needs GitLab" intents.
export const SKILL_DESCRIPTION =
  "Operate GitLab through the glab-axi CLI - merge requests, issues, repositories, and raw API access. " +
  "Use whenever a task touches GitLab: listing or filing issues, reviewing or merging merge requests, " +
  "inspecting projects, or calling the GitLab API via `api`, `mr list/view/create/merge/close/reopen`, " +
  "`issue list/view/create/close`, or `repo view`.";

export const SKILL_AUTHOR = "Kun Chen (kunchenguid)";

// Extended frontmatter read by Nous Research's Hermes Agent harness
// (https://hermes-agent.nousresearch.com/docs/user-guide/features/skills).
// Harnesses that don't know these fields (e.g. Claude Code) ignore them.
export const HERMES_TAGS = ["gitlab", "git", "merge-requests", "issues"];
export const HERMES_CATEGORY = "devops";

// Hard cap so a future regeneration cannot silently re-inflate the stub with
// CLI-owned instructions. Dashboard, `--help`, and per-command help are the
// source of truth.
export const MAX_SKILL_MARKDOWN_CHARS = 2500;

function yamlDoubleQuote(value: string): string {
  return JSON.stringify(value);
}

/**
 * Render the installable SKILL.md for the glab-axi skill.
 *
 * This is a discovery stub, not a copy of CLI guidance. Installed skills go
 * stale; `glab-axi` (dashboard), `glab-axi --help`, and `glab-axi <command> --help`
 * do not. Keep the body to what glab-axi is, when to reach for it, and pointers
 * at those commands.
 *
 * @returns full SKILL.md contents including YAML frontmatter
 */
export function createSkillMarkdown(): string {
  const markdown = `---
name: glab-axi
description: ${yamlDoubleQuote(SKILL_DESCRIPTION)}
user-invocable: false
author: ${SKILL_AUTHOR}
metadata:
  hermes:
    tags: [${HERMES_TAGS.join(", ")}]
    category: ${HERMES_CATEGORY}
---

# glab-axi

${DESCRIPTION}

Use glab-axi whenever a task touches GitLab: merge requests, issues, repositories, or the GitLab API — on gitlab.com and self-hosted instances alike.

## Current guidance lives in the CLI

Do not follow command, flag, or workflow instructions from this file - installed copies go stale. Get the current source of truth from the CLI:

- \`glab-axi\` for a dashboard of the current project
- \`glab-axi --help\` for global flags and the command index
- \`glab-axi <command> --help\` for per-command usage
`;

  if (markdown.length > MAX_SKILL_MARKDOWN_CHARS) {
    throw new Error(
      `generated SKILL.md is ${markdown.length} chars; keep it a stub under ${MAX_SKILL_MARKDOWN_CHARS} and defer guidance to the CLI`,
    );
  }

  return markdown;
}
