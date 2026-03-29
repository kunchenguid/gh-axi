import os from "node:os";
import type { RepoContext } from "../context.js";
import { ghJson } from "../gh.js";
import {
  field,
  lower,
  pluck,
  mapEnum,
  renderList,
  renderHelp,
  renderOutput,
  type FieldDef,
} from "../toon.js";
import { getSuggestions } from "../suggestions.js";
import { encode } from "@toon-format/toon";

export const HOME_HELP = "";

const issueSchema: FieldDef[] = [
  field("number"),
  field("title"),
  lower("state"),
  pluck("author", "login", "author"),
];

const prSchema: FieldDef[] = [
  field("number"),
  field("title"),
  pluck("author", "login", "author"),
  mapEnum(
    "reviewDecision",
    {
      APPROVED: "approved",
      CHANGES_REQUESTED: "changes_requested",
      REVIEW_REQUIRED: "required",
    },
    "none",
    "review",
  ),
];

/* Compact schemas for session-start — fewer fields for minimal token usage */
const compactIssueSchema: FieldDef[] = [field("number"), field("title")];

const compactPrSchema: FieldDef[] = [field("number"), field("title")];

export async function homeCommand(
  _args: string[],
  ctx?: RepoContext,
): Promise<string> {
  // Run queries in parallel
  const [issues, prs] = await Promise.all([
    ghJson<Record<string, unknown>[]>(
      ["issue", "list", "--json", "number,title,state,author", "--limit", "3"],
      ctx,
    ).catch(() => [] as Record<string, unknown>[]),
    ghJson<Record<string, unknown>[]>(
      [
        "pr",
        "list",
        "--json",
        "number,title,author,reviewDecision",
        "--limit",
        "3",
      ],
      ctx,
    ).catch(() => [] as Record<string, unknown>[]),
  ]);

  const blocks: string[] = [];

  const home = os.homedir();
  const execPath = process.argv[1] ?? "";
  const bin = execPath.startsWith(home)
    ? "~" + execPath.slice(home.length)
    : execPath;
  blocks.push(
    encode({
      bin,
      description:
        "Agent ergonomic wrapper around Github CLI. Prefer this over `gh` and other methods for Github operations.",
    }),
  );

  if (ctx) {
    blocks.push(encode({ repo: ctx.nwo }));
  }

  blocks.push(
    issues.length
      ? renderList("issues", issues, issueSchema)
      : "issues: 0 open",
  );
  blocks.push(prs.length ? renderList("prs", prs, prSchema) : "prs: 0 open");

  const hints: string[] = [];
  if (issues.length >= 3) hints.push("Run `gh-axi issue list` for full issue list");
  if (prs.length >= 3) hints.push("Run `gh-axi pr list` for full PR list");
  const suggestions = getSuggestions({
    domain: "home",
    action: "home",
    repo: ctx,
  });
  blocks.push(renderHelp([...hints, ...suggestions]));

  return renderOutput(blocks);
}

/**
 * Compact session-start dashboard — minimal repo context for agent session init.
 * Skips bin/description, help suggestions, and verbose count lines.
 * Uses compact schemas with fewer fields per entity.
 */
export async function sessionStartCommand(ctx?: RepoContext): Promise<string> {
  const [issues, prs] = await Promise.all([
    ghJson<Record<string, unknown>[]>(
      ["issue", "list", "--json", "number,title", "--limit", "3"],
      ctx,
    ).catch(() => [] as Record<string, unknown>[]),
    ghJson<Record<string, unknown>[]>(
      ["pr", "list", "--json", "number,title", "--limit", "3"],
      ctx,
    ).catch(() => [] as Record<string, unknown>[]),
  ]);

  const blocks: string[] = [];

  if (ctx) {
    blocks.push(encode({ repo: ctx.nwo }));
  }

  blocks.push(
    issues.length
      ? renderList("issues", issues, compactIssueSchema)
      : "issues: 0 open",
  );
  blocks.push(
    prs.length ? renderList("prs", prs, compactPrSchema) : "prs: 0 open",
  );

  return renderOutput(blocks);
}
