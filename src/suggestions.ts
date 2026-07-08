import type { RepoContext } from "./context.js";
import { DEFAULT_HOST, type HostContext } from "./host.js";

interface SuggestionContext {
  domain: string;
  action: string;
  state?: string;
  isEmpty?: boolean;
  /** The entity number/id/tag for substitution */
  id?: string | number;
  repo?: RepoContext;
  host?: HostContext;
  /** Resolved --owner for owner-scoped domains (e.g. project) */
  owner?: string;
}

type SuggestionEntry = {
  match: (ctx: SuggestionContext) => boolean;
  lines: (ctx: SuggestionContext) => string[];
};

function repoFlag(ctx: SuggestionContext): string {
  if (ctx.repo && ctx.repo.source !== "git") {
    return ` -R ${ctx.repo.nwo}`;
  }
  return "";
}

function ownerFlag(ctx: SuggestionContext): string {
  return ctx.owner ? ` --owner ${ctx.owner}` : "";
}

function normalizeRepoFlagLine(line: string): string {
  return line.replace(/`gh-axi -R ([^`\s]+) ([^`]+)`/g, "`gh-axi $2 -R $1`");
}

let activeHost: HostContext | undefined;

export async function withSuggestionHost<T>(
  host: HostContext | undefined,
  callback: () => Promise<T>,
): Promise<T> {
  const previousHost = activeHost;
  activeHost = host;
  try {
    return await callback();
  } finally {
    activeHost = previousHost;
  }
}

function hostnameFlag(ctx: SuggestionContext): string {
  const host = ctx.host ?? ctx.repo?.host ?? activeHost;
  if (!host || host.source !== "flag" || host.value === DEFAULT_HOST) {
    return "";
  }
  return ` --hostname ${host.value}`;
}

function appendHostnameFlag(line: string, ctx: SuggestionContext): string {
  const flag = hostnameFlag(ctx);
  if (!flag) {
    return line;
  }
  return line.replace(/`([^`]*\bgh-axi\b[^`]*)`/g, `\`$1${flag}\``);
}

const table: SuggestionEntry[] = [
  // Home
  {
    match: (c) => c.domain === "home",
    lines: () => [
      `Run \`gh-axi <command> <subcommand>\` — commands: issue, pr, run, release, repo, label, secret, variable`,
    ],
  },

  // Issue list
  {
    match: (c) => c.domain === "issue" && c.action === "list" && !c.isEmpty,
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} issue view <number>\` to view details`,
      `Run \`gh-axi${repoFlag(c)} issue create --title "..." --body-file <path>\` to create`,
    ],
  },
  {
    match: (c) =>
      c.domain === "issue" && c.action === "list" && c.isEmpty === true,
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} issue create --title "..." --body-file <path>\` to create an issue`,
      `Run \`gh-axi${repoFlag(c)} issue list --state closed\` to see closed issues`,
    ],
  },

  // Issue view
  {
    match: (c) =>
      c.domain === "issue" && c.action === "view" && c.state === "open",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} issue comment ${c.id} --body-file <path>\` to comment`,
      `Run \`gh-axi${repoFlag(c)} issue close ${c.id}\` to close`,
      `Run \`gh-axi${repoFlag(c)} issue edit ${c.id} --add-assignee <user>\` to assign`,
      `Run \`gh-axi search prs "${c.id}"${c.repo ? ` --repo ${c.repo.nwo}` : ""}\` to find PRs referencing this issue`,
    ],
  },
  {
    match: (c) =>
      c.domain === "issue" && c.action === "view" && c.state === "closed",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} issue reopen ${c.id}\` to reopen`,
      `Run \`gh-axi${repoFlag(c)} issue comment ${c.id} --body-file <path>\` to comment`,
      `Run \`gh-axi search prs "${c.id}"${c.repo ? ` --repo ${c.repo.nwo}` : ""}\` to find PRs referencing this issue`,
    ],
  },

  // Issue create
  {
    match: (c) => c.domain === "issue" && c.action === "create",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} issue view ${c.id}\` to see the full issue`,
      `Run \`gh-axi${repoFlag(c)} issue edit ${c.id} --add-label <label>\` to label`,
    ],
  },

  // Issue close
  {
    match: (c) => c.domain === "issue" && c.action === "close",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} issue reopen ${c.id}\` to reopen`,
    ],
  },

  // Issue reopen
  {
    match: (c) => c.domain === "issue" && c.action === "reopen",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} issue close ${c.id}\` to close`,
      `Run \`gh-axi${repoFlag(c)} issue view ${c.id}\` to see details`,
    ],
  },

  // Issue edit
  {
    match: (c) => c.domain === "issue" && c.action === "edit",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} issue view ${c.id}\` to see updated issue`,
    ],
  },

  // Issue comment
  {
    match: (c) => c.domain === "issue" && c.action === "comment",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} issue view ${c.id} --comments\` to see all comments`,
    ],
  },

  // Issue delete
  {
    match: (c) => c.domain === "issue" && c.action === "delete",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} issue list\` to see remaining issues`,
    ],
  },

  // Issue lock/unlock/pin/unpin
  {
    match: (c) =>
      c.domain === "issue" &&
      ["lock", "unlock", "pin", "unpin"].includes(c.action),
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} issue view ${c.id}\` to see issue details`,
    ],
  },

  // Issue transfer
  {
    match: (c) => c.domain === "issue" && c.action === "transfer",
    lines: () => [],
  },

  // PR list
  {
    match: (c) => c.domain === "pr" && c.action === "list" && !c.isEmpty,
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} pr view <number>\` to view details`,
      `Run \`gh-axi${repoFlag(c)} pr create --title "..." --body-file <path>\` to create`,
    ],
  },
  {
    match: (c) =>
      c.domain === "pr" && c.action === "list" && c.isEmpty === true,
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} pr create --title "..." --body-file <path>\` to create a PR`,
      `Run \`gh-axi${repoFlag(c)} pr list --state closed\` to see closed PRs`,
    ],
  },

  // PR view
  {
    match: (c) =>
      c.domain === "pr" && c.action === "view" && c.state === "open",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} pr checks ${c.id}\` to see CI status`,
      `Run \`gh-axi${repoFlag(c)} pr review ${c.id} --approve\` to approve`,
      `Run \`gh-axi${repoFlag(c)} pr merge ${c.id}\` to merge`,
    ],
  },
  {
    match: (c) =>
      c.domain === "pr" && c.action === "view" && c.state === "closed",
    lines: (c) => [`Run \`gh-axi${repoFlag(c)} pr reopen ${c.id}\` to reopen`],
  },
  {
    match: (c) =>
      c.domain === "pr" && c.action === "view" && c.state === "merged",
    lines: (c) => [`Run \`gh-axi${repoFlag(c)} pr revert ${c.id}\` to revert`],
  },

  // PR create
  {
    match: (c) => c.domain === "pr" && c.action === "create",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} pr view ${c.id}\` to see the full PR`,
      `Run \`gh-axi${repoFlag(c)} pr checks ${c.id}\` to monitor CI`,
    ],
  },

  // PR close
  {
    match: (c) => c.domain === "pr" && c.action === "close",
    lines: (c) => [`Run \`gh-axi${repoFlag(c)} pr reopen ${c.id}\` to reopen`],
  },

  // PR merge
  {
    match: (c) => c.domain === "pr" && c.action === "merge",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} pr revert ${c.id}\` to revert if needed`,
    ],
  },

  // PR review
  {
    match: (c) => c.domain === "pr" && c.action === "review",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} pr view ${c.id}\` to see PR details`,
    ],
  },

  // PR checks
  {
    match: (c) => c.domain === "pr" && c.action === "checks",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} pr view ${c.id}\` to see PR details`,
      `Run \`gh-axi${repoFlag(c)} pr merge ${c.id}\` to merge when ready`,
    ],
  },

  // PR diff
  {
    match: (c) => c.domain === "pr" && c.action === "diff",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} pr review ${c.id} --approve\` to approve`,
    ],
  },

  // PR checkout
  {
    match: (c) => c.domain === "pr" && c.action === "checkout",
    lines: () => [],
  },

  // PR ready
  {
    match: (c) => c.domain === "pr" && c.action === "ready",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} pr view ${c.id}\` to see PR status`,
    ],
  },

  // PR reopen
  {
    match: (c) => c.domain === "pr" && c.action === "reopen",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} pr view ${c.id}\` to see PR details`,
    ],
  },

  // PR comment
  {
    match: (c) => c.domain === "pr" && c.action === "comment",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} pr view ${c.id} --comments\` to see all comments`,
    ],
  },

  // PR update-branch
  {
    match: (c) => c.domain === "pr" && c.action === "update-branch",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} pr checks ${c.id}\` to monitor CI after update`,
    ],
  },

  // PR revert
  {
    match: (c) => c.domain === "pr" && c.action === "revert",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} pr view ${c.id}\` to see the revert PR`,
    ],
  },

  // Run list
  {
    match: (c) => c.domain === "run" && c.action === "list",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} run view <id>\` to view details`,
    ],
  },

  // Run view
  {
    match: (c) =>
      c.domain === "run" && c.action === "view" && c.state === "completed",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} run rerun ${c.id}\` to rerun`,
      `Run \`gh-axi${repoFlag(c)} run view ${c.id} --log-failed\` to see failure logs`,
    ],
  },
  {
    match: (c) =>
      c.domain === "run" && c.action === "view" && c.state === "in_progress",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} run watch ${c.id}\` to watch until completion`,
      `Run \`gh-axi${repoFlag(c)} run cancel ${c.id}\` to cancel`,
    ],
  },
  {
    match: (c) => c.domain === "run" && c.action === "view",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} run view ${c.id} --log\` to see run logs`,
    ],
  },

  // Run rerun/cancel/delete
  {
    match: (c) => c.domain === "run" && c.action === "rerun",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} run watch ${c.id}\` to monitor progress`,
    ],
  },
  {
    match: (c) => c.domain === "run" && c.action === "cancel",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} run view ${c.id}\` to see final state`,
    ],
  },
  {
    match: (c) => c.domain === "run" && c.action === "delete",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} run list\` to see remaining runs`,
    ],
  },

  // Run watch
  {
    match: (c) => c.domain === "run" && c.action === "watch",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} run view ${c.id}\` to see details`,
    ],
  },

  // Run download
  {
    match: (c) => c.domain === "run" && c.action === "download",
    lines: () => [],
  },

  // Workflow list
  {
    match: (c) => c.domain === "workflow" && c.action === "list",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} workflow view <id>\` to view details`,
      `Run \`gh-axi${repoFlag(c)} workflow run <id>\` to trigger a run`,
    ],
  },

  // Workflow view
  {
    match: (c) => c.domain === "workflow" && c.action === "view",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} workflow run ${c.id}\` to trigger`,
      `Run \`gh-axi${repoFlag(c)} run list --workflow ${c.id}\` to see past runs`,
    ],
  },

  // Workflow run
  {
    match: (c) => c.domain === "workflow" && c.action === "run",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} run list\` to see triggered run`,
    ],
  },

  // Workflow enable/disable
  {
    match: (c) =>
      c.domain === "workflow" && ["enable", "disable"].includes(c.action),
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} workflow list\` to see all workflows`,
    ],
  },

  // Release list
  {
    match: (c) => c.domain === "release" && c.action === "list",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} release view <tag>\` to view details`,
      `Run \`gh-axi${repoFlag(c)} release create <tag> --body-file <path>\` to create a release`,
    ],
  },

  // Release view
  {
    match: (c) => c.domain === "release" && c.action === "view",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} release download ${c.id}\` to download assets`,
      `Run \`gh-axi${repoFlag(c)} release edit ${c.id} --body-file <path>\` to edit notes`,
    ],
  },

  // Release create
  {
    match: (c) => c.domain === "release" && c.action === "create",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} release view ${c.id}\` to view the release`,
      `Run \`gh-axi${repoFlag(c)} release upload ${c.id} <files...>\` to upload assets`,
    ],
  },

  // Release edit/delete
  {
    match: (c) => c.domain === "release" && c.action === "edit",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} release view ${c.id}\` to see updated release`,
    ],
  },
  {
    match: (c) => c.domain === "release" && c.action === "delete",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} release list\` to see remaining releases`,
    ],
  },

  // Release download/upload
  {
    match: (c) => c.domain === "release" && c.action === "download",
    lines: () => [],
  },
  {
    match: (c) => c.domain === "release" && c.action === "upload",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} release view ${c.id}\` to see all assets`,
    ],
  },

  // Repo view
  {
    match: (c) => c.domain === "repo" && c.action === "view",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} issue list\` to see issues`,
      `Run \`gh-axi${repoFlag(c)} pr list\` to see pull requests`,
    ],
  },

  // Repo create
  {
    match: (c) => c.domain === "repo" && c.action === "create",
    lines: () => [],
  },

  // Repo list
  {
    match: (c) => c.domain === "repo" && c.action === "list",
    lines: () => [
      `Run \`gh-axi repo view -R <owner/name>\` to view a repository`,
    ],
  },

  // Repo edit/clone/fork
  {
    match: (c) =>
      c.domain === "repo" && ["edit", "clone", "fork"].includes(c.action),
    lines: () => [],
  },

  // Label list
  {
    match: (c) => c.domain === "label" && c.action === "list",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} label create --name "..." --color "..."\` to create a label`,
    ],
  },

  // Label create/edit/delete
  {
    match: (c) => c.domain === "label" && c.action === "create",
    lines: (c) => [`Run \`gh-axi${repoFlag(c)} label list\` to see all labels`],
  },
  {
    match: (c) => c.domain === "label" && c.action === "edit",
    lines: (c) => [`Run \`gh-axi${repoFlag(c)} label list\` to see all labels`],
  },
  {
    match: (c) => c.domain === "label" && c.action === "delete",
    lines: (c) => [
      `Run \`gh-axi${repoFlag(c)} label list\` to see remaining labels`,
    ],
  },

  // Project list
  {
    match: (c) => c.domain === "project" && c.action === "list" && !c.isEmpty,
    lines: (c) => [
      `Run \`gh-axi project view <number>${ownerFlag(c)}\` to view details`,
      `Run \`gh-axi project create --title "..."${ownerFlag(c)}\` to create a project`,
    ],
  },
  {
    match: (c) =>
      c.domain === "project" && c.action === "list" && c.isEmpty === true,
    lines: (c) => [
      `Run \`gh-axi project create --title "..."${ownerFlag(c)}\` to create a project`,
    ],
  },

  // Project create/edit/close/copy
  {
    match: (c) => c.domain === "project" && c.action === "create",
    lines: (c) => [
      `Run \`gh-axi project view ${c.id}${ownerFlag(c)}\` to see the new project`,
      `Run \`gh-axi project item-add ${c.id} --url <issue-or-pr-url>${ownerFlag(c)}\` to add items`,
    ],
  },
  {
    match: (c) => c.domain === "project" && c.action === "edit",
    lines: (c) => [
      `Run \`gh-axi project view ${c.id}${ownerFlag(c)}\` to see the updated project`,
    ],
  },
  {
    match: (c) => c.domain === "project" && c.action === "close",
    lines: (c) => [
      `Run \`gh-axi project close ${c.id} --undo${ownerFlag(c)}\` to reopen`,
    ],
  },
  {
    match: (c) => c.domain === "project" && c.action === "copy",
    lines: (c) => [
      `Run \`gh-axi project view ${c.id}${ownerFlag(c)}\` to see the copied project`,
    ],
  },

  // Project item-list / field-list
  {
    match: (c) => c.domain === "project" && c.action === "item-list",
    lines: (c) => [
      `Run \`gh-axi project item-add ${c.id} --url <issue-or-pr-url>${ownerFlag(c)}\` to add an item`,
      `Run \`gh-axi project field-list ${c.id}${ownerFlag(c)}\` to see project fields`,
    ],
  },
  {
    match: (c) => c.domain === "project" && c.action === "field-list",
    lines: () => [
      `Run \`gh-axi project item-edit --id <item-id> --field-id <field-id> --project-id <project-id> --text "..."\` to set a field value`,
    ],
  },

  // Project item-add/item-create/item-edit/item-archive/item-delete
  {
    match: (c) =>
      c.domain === "project" && ["item-add", "item-create"].includes(c.action),
    lines: (c) => [
      `Run \`gh-axi project item-list ${c.id}${ownerFlag(c)}\` to see all items`,
    ],
  },
  {
    match: (c) => c.domain === "project" && c.action === "item-edit",
    lines: () => [],
  },
  {
    match: (c) =>
      c.domain === "project" &&
      ["item-archive", "item-delete"].includes(c.action),
    lines: (c) => [
      `Run \`gh-axi project item-list ${c.id}${ownerFlag(c)}\` to see remaining items`,
    ],
  },

  // Secret list
  {
    match: (c) => c.domain === "secret" && c.action === "list" && !c.isEmpty,
    lines: (c) => [
      `Run \`echo -n "<value>" | gh-axi secret set <name>${repoFlag(c)}\` to add or update a secret`,
    ],
  },
  {
    match: (c) =>
      c.domain === "secret" && c.action === "list" && c.isEmpty === true,
    lines: (c) => [
      `Run \`echo -n "<value>" | gh-axi secret set <name>${repoFlag(c)}\` to add a secret`,
    ],
  },

  // Secret set/delete
  {
    match: (c) => c.domain === "secret" && c.action === "set",
    lines: (c) => [
      `Run \`gh-axi secret list${repoFlag(c)}\` to see all secrets`,
    ],
  },
  {
    match: (c) => c.domain === "secret" && c.action === "delete",
    lines: (c) => [
      `Run \`gh-axi secret list${repoFlag(c)}\` to see remaining secrets`,
    ],
  },

  // Variable list
  {
    match: (c) => c.domain === "variable" && c.action === "list" && !c.isEmpty,
    lines: (c) => [
      `Run \`gh-axi variable set <name> --body <value>${repoFlag(c)}\` to add or update a variable`,
    ],
  },
  {
    match: (c) =>
      c.domain === "variable" && c.action === "list" && c.isEmpty === true,
    lines: (c) => [
      `Run \`gh-axi variable set <name> --body <value>${repoFlag(c)}\` to add a variable`,
    ],
  },

  // Variable set/delete
  {
    match: (c) => c.domain === "variable" && c.action === "set",
    lines: (c) => [
      `Run \`gh-axi variable list${repoFlag(c)}\` to see all variables`,
    ],
  },
  {
    match: (c) => c.domain === "variable" && c.action === "delete",
    lines: (c) => [
      `Run \`gh-axi variable list${repoFlag(c)}\` to see remaining variables`,
    ],
  },

  // Search
  {
    match: (c) => c.domain === "search",
    lines: () => [],
  },

  // API
  {
    match: (c) => c.domain === "api",
    lines: () => [],
  },
];

export function getSuggestions(ctx: SuggestionContext): string[] {
  for (const entry of table) {
    if (entry.match(ctx)) {
      return entry
        .lines(ctx)
        .map(normalizeRepoFlagLine)
        .map((line) => appendHostnameFlag(line, ctx));
    }
  }
  return [];
}
