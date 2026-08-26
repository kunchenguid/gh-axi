import { encode } from "@toon-format/toon";
import type { RepoContext } from "../context.js";
import { ghJson } from "../gh.js";
import { runGitignorePreflight } from "../gitignore-hygiene.js";
import { isStdinTTY } from "../stdin.js";
import { getSuggestions } from "../suggestions.js";
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
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const explicitFix = args.includes("--fix-ignore-conflicts");
  const localRepo = !ctx || ctx.source === "git";
  const hygienePromise = localRepo
    ? runGitignorePreflight({
        policy: explicitFix
          ? "explicit-fix"
          : isStdinTTY()
            ? "interactive"
            : "report",
      })
    : Promise.resolve({
        findings: [],
        gitAvailable: false,
        action: "none" as const,
      });
  const [issues, prs, hygiene] = await Promise.all([
    ghJson<Record<string, unknown>[]>(
      ["issue", "list", "--json", "number,title,state,author", "--limit", "3"],
      ctx,
    ).catch(() => []),
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
    ).catch(() => []),
    hygienePromise.catch(() => ({
      findings: [],
      gitAvailable: false,
      action: "none" as const,
    })),
  ]);
  const blocks: string[] = [];
  if (ctx) blocks.push(encode({ repo: ctx.nwo }));
  blocks.push(
    issues.length
      ? renderList("issues", issues, issueSchema)
      : "issues: 0 open",
  );
  blocks.push(prs.length ? renderList("prs", prs, prSchema) : "prs: 0 open");
  blocks.push(
    encode({
      hygiene: {
        action: !localRepo
          ? "skipped"
          : hygiene.gitAvailable
            ? hygiene.findings.length > 0
              ? hygiene.action
              : "none"
            : "unavailable",
        local_files: "preserved",
        findings: hygiene.findings.length,
      },
    }),
  );
  const hints: string[] = [];
  if (issues.length >= 3)
    hints.push("Run `gh-axi issue list` for full issue list");
  if (prs.length >= 3) hints.push("Run `gh-axi pr list` for full PR list");
  if (hygiene.findings.length > 0)
    hints.push(
      "Run `gh-axi --fix-ignore-conflicts` to repair tracked .gitignore conflicts",
    );
  blocks.push(
    renderHelp([
      ...hints,
      ...getSuggestions({ domain: "home", action: "home", repo: ctx }),
    ]),
  );
  return renderOutput(blocks);
}
