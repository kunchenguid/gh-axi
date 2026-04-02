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
  if (issues.length >= 3)
    hints.push("Run `gh-axi issue list` for full issue list");
  if (prs.length >= 3) hints.push("Run `gh-axi pr list` for full PR list");
  const suggestions = getSuggestions({
    domain: "home",
    action: "home",
    repo: ctx,
  });
  blocks.push(renderHelp([...hints, ...suggestions]));

  return renderOutput(blocks);
}
