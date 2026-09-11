import type { ProjectContext } from "../context.js";
import { glabJson } from "../glab.js";
import {
  field,
  pluck,
  lower,
  renderList,
  renderHelp,
  renderOutput,
  type FieldDef,
} from "../toon.js";
import { getSuggestions } from "../suggestions.js";
import { encode } from "@toon-format/toon";

export const HOME_HELP = "";

const issueSchema: FieldDef[] = [
  field("iid"),
  field("title"),
  lower("state"),
  pluck("author", "username", "author"),
];

const mrSchema: FieldDef[] = [
  field("iid"),
  field("title"),
  pluck("author", "username", "author"),
  lower("state"),
  field("source_branch", "branch"),
];

export async function homeCommand(
  _args: string[],
  ctx?: ProjectContext,
): Promise<string> {
  // Run queries in parallel. glab issue list reads JSON via -O json (its -F
  // means details|ids|urls); glab mr list reads JSON via -F json.
  const [issues, mrs] = await Promise.all([
    glabJson<Record<string, unknown>[]>(
      ["issue", "list", "-O", "json", "--per-page", "3"],
      ctx,
    ).catch(() => [] as Record<string, unknown>[]),
    glabJson<Record<string, unknown>[]>(
      ["mr", "list", "-F", "json", "--per-page", "3"],
      ctx,
    ).catch(() => [] as Record<string, unknown>[]),
  ]);

  const blocks: string[] = [];

  if (ctx) {
    blocks.push(encode({ project: ctx.fullPath }));
  }

  blocks.push(
    issues.length
      ? renderList("issues", issues, issueSchema)
      : "issues: 0 opened",
  );
  blocks.push(mrs.length ? renderList("mrs", mrs, mrSchema) : "mrs: 0 opened");

  const hints: string[] = [];
  if (issues.length >= 3)
    hints.push("Run `glab-axi issue list` for full issue list");
  if (mrs.length >= 3) hints.push("Run `glab-axi mr list` for full MR list");
  const suggestions = getSuggestions({
    domain: "home",
    action: "home",
    repo: ctx,
  });
  blocks.push(renderHelp([...hints, ...suggestions]));

  return renderOutput(blocks);
}
