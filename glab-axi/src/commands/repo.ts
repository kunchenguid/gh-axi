import type { ProjectContext } from "../context.js";
import { glabJson } from "../glab.js";
import { AxiError } from "../errors.js";
import { rejectUnknownFlags } from "../args.js";
import { getSuggestions } from "../suggestions.js";
import {
  field,
  lower,
  renderDetail,
  renderError,
  renderHelp,
  renderOutput,
  type FieldDef,
} from "../toon.js";

export const REPO_FLAGS: Record<string, readonly string[]> = {
  view: [],
};

export const REPO_HELP = `usage: glab-axi repo view [<full/path>]
description: View a GitLab project. A project path nests arbitrarily (group/subgroup/project); pass the full path.
flags{view}:
  --repo <full/path> or exactly one positional full/path; choose one selector
examples:
  glab-axi repo view
  glab-axi repo view group/subgroup/project
  glab-axi repo view --repo group/subgroup/project --hostname git.example.com`;

const viewSchema: FieldDef[] = [
  field("name_with_namespace", "name"),
  field("description"),
  field("default_branch", "branch"),
  field("star_count", "stars"),
  field("forks_count", "forks"),
  field("open_issues_count", "issues"),
  lower("visibility"),
  field("web_url", "url"),
];

async function viewProject(
  args: string[],
  ctx?: ProjectContext,
): Promise<string> {
  const positionals = args.filter((a) => !a.startsWith("-"));
  const repoArg = positionals[1];
  const extraArg = positionals[2];
  if (repoArg && ctx && ctx.source !== "git") {
    const selector = ctx.source === "flag" ? "--repo" : "GITLAB_REPO";
    throw new AxiError(
      `Unsupported positional argument for repo view with ${selector}: ${repoArg}. Use one project selector, not both.`,
      "VALIDATION_ERROR",
    );
  }
  if (extraArg) {
    throw new AxiError(
      `Unsupported positional argument for repo view: ${extraArg}. Use --repo <full/path> to select a project.`,
      "VALIDATION_ERROR",
    );
  }

  const glabArgs = ["repo", "view", "-F", "json"];
  // glab repo view accepts a positional project path; keep that parity only
  // when it does not conflict with glab-axi's command-first -R targeting.
  if (repoArg) glabArgs.push(repoArg);
  // Else: a -R from flag/env is appended by buildArgs; a git checkout lets
  // glab detect the project itself.
  const project = await glabJson<Record<string, unknown>>(glabArgs, ctx);

  return renderOutput([
    renderDetail("project", project, viewSchema),
    renderHelp(
      getSuggestions({
        domain: "repo",
        action: "view",
        // Suggestions must target the project that was displayed, which is the
        // positional when one is given, not the checkout glab-axi runs in.
        repo: repoArg
          ? { fullPath: repoArg, source: "flag" }
          : ctx,
      }),
    ),
  ]);
}

export async function repoCommand(
  args: string[],
  ctx?: ProjectContext,
): Promise<string> {
  const sub = args[0];

  if (sub === "--help" || sub === "-h" || sub === undefined) {
    return REPO_HELP;
  }

  switch (sub) {
    case "view":
      rejectUnknownFlags(args.slice(1), REPO_FLAGS.view, "repo", "view");
      return viewProject(args, ctx);
    default:
      return renderError(`Unknown repo subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Available subcommands: view",
        "Run `glab-axi repo --help` for usage",
      ]);
  }
}
