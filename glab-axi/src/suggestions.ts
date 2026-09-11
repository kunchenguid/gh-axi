import type { ProjectContext } from "./context.js";
import { DEFAULT_HOST, type HostContext } from "./host.js";

interface SuggestionContext {
  domain: string;
  action: string;
  state?: string;
  isEmpty?: boolean;
  /** The entity number for substitution */
  id?: string | number;
  repo?: ProjectContext;
}

type SuggestionEntry = {
  match: (ctx: SuggestionContext) => boolean;
  lines: (ctx: SuggestionContext) => string[];
};

function repoFlag(ctx: SuggestionContext): string {
  if (ctx.repo && ctx.repo.source !== "git") {
    return ` -R ${ctx.repo.fullPath}`;
  }
  return "";
}

function normalizeRepoFlagLine(line: string): string {
  return line.replace(/`glab-axi -R ([^`\s]+) ([^`]+)`/g, "`glab-axi $2 -R $1`");
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

function hostnameFlag(): string {
  const host = activeHost;
  if (!host || host.source !== "flag" || host.value === DEFAULT_HOST) {
    return "";
  }
  return ` --hostname ${host.value}`;
}

function appendHostnameFlag(line: string): string {
  const flag = hostnameFlag();
  if (!flag) {
    return line;
  }
  return line.replace(/`([^`]*\bglab-axi\b[^`]*)`/g, `\`$1${flag}\``);
}

const table: SuggestionEntry[] = [
  // Home
  {
    match: (c) => c.domain === "home",
    lines: () => [
      "Run `glab-axi <command> <subcommand>` — commands: mr, issue, repo, api",
    ],
  },

  // MR list
  {
    match: (c) => c.domain === "mr" && c.action === "list" && !c.isEmpty,
    lines: (c) => [
      `Run \`glab-axi${repoFlag(c)} mr view <number>\` to view details`,
      `Run \`glab-axi${repoFlag(c)} mr create --title "..." --description-file <path>\` to create`,
    ],
  },
  {
    match: (c) => c.domain === "mr" && c.action === "list" && c.isEmpty === true,
    lines: (c) => [
      `Run \`glab-axi${repoFlag(c)} mr create --title "..." --description-file <path>\` to create an MR`,
      `Run \`glab-axi${repoFlag(c)} mr list --state merged\` to see merged MRs`,
    ],
  },

  // MR view
  {
    match: (c) => c.domain === "mr" && c.action === "view" && c.state === "opened",
    lines: (c) => [
      `Run \`glab-axi${repoFlag(c)} mr merge ${c.id}\` to merge`,
      `Run \`glab-axi${repoFlag(c)} mr close ${c.id}\` to close`,
    ],
  },
  {
    match: (c) => c.domain === "mr" && c.action === "view" && c.state === "closed",
    lines: (c) => [
      `Run \`glab-axi${repoFlag(c)} mr reopen ${c.id}\` to reopen`,
    ],
  },
  {
    match: (c) => c.domain === "mr" && c.action === "view" && c.state === "merged",
    lines: () => [],
  },

  // MR create
  {
    match: (c) => c.domain === "mr" && c.action === "create",
    lines: (c) => [
      `Run \`glab-axi${repoFlag(c)} mr view ${c.id}\` to see the full MR`,
    ],
  },

  // MR merge
  {
    match: (c) => c.domain === "mr" && c.action === "merge",
    lines: (c) => [
      `Run \`glab-axi${repoFlag(c)} mr view ${c.id}\` to see the merged MR`,
    ],
  },

  // MR close
  {
    match: (c) => c.domain === "mr" && c.action === "close",
    lines: (c) => [
      `Run \`glab-axi${repoFlag(c)} mr reopen ${c.id}\` to reopen`,
    ],
  },

  // MR reopen
  {
    match: (c) => c.domain === "mr" && c.action === "reopen",
    lines: (c) => [
      `Run \`glab-axi${repoFlag(c)} mr view ${c.id}\` to see MR details`,
    ],
  },

  // Issue list
  {
    match: (c) => c.domain === "issue" && c.action === "list" && !c.isEmpty,
    lines: (c) => [
      `Run \`glab-axi${repoFlag(c)} issue view <number>\` to view details`,
      `Run \`glab-axi${repoFlag(c)} issue create --title "..." --description-file <path>\` to create`,
    ],
  },
  {
    match: (c) =>
      c.domain === "issue" && c.action === "list" && c.isEmpty === true,
    lines: (c) => [
      `Run \`glab-axi${repoFlag(c)} issue create --title "..." --description-file <path>\` to create an issue`,
      `Run \`glab-axi${repoFlag(c)} issue list --state closed\` to see closed issues`,
    ],
  },

  // Issue view
  {
    match: (c) =>
      c.domain === "issue" && c.action === "view" && c.state === "opened",
    lines: (c) => [
      `Run \`glab-axi${repoFlag(c)} issue close ${c.id}\` to close`,
    ],
  },
  {
    match: (c) =>
      c.domain === "issue" && c.action === "view" && c.state === "closed",
    lines: (c) => [`Run \`glab-axi${repoFlag(c)} issue list --state closed\` to see closed issues`],
  },

  // Issue create
  {
    match: (c) => c.domain === "issue" && c.action === "create",
    lines: (c) => [
      `Run \`glab-axi${repoFlag(c)} issue view ${c.id}\` to see the full issue`,
    ],
  },

  // Issue close
  {
    match: (c) => c.domain === "issue" && c.action === "close",
    lines: (c) => [
      `Run \`glab-axi${repoFlag(c)} issue list\` to see open issues`,
    ],
  },

  // Repo view
  {
    match: (c) => c.domain === "repo" && c.action === "view",
    lines: (c) => [
      `Run \`glab-axi${repoFlag(c)} issue list\` to see issues`,
      `Run \`glab-axi${repoFlag(c)} mr list\` to see merge requests`,
    ],
  },

  // API — point a raw response at the structured command for the same resource
  {
    match: (c) =>
      c.domain === "api" &&
      (c.action === "mr" || c.action === "issue") &&
      c.id !== undefined,
    lines: (c) => [
      `Run \`glab-axi${repoFlag(c)} ${c.action} view ${c.id}\` for the same ${c.action === "mr" ? "merge request" : "issue"} as structured output`,
    ],
  },
  {
    match: (c) =>
      c.domain === "api" && (c.action === "mr" || c.action === "issue"),
    lines: (c) => [
      `Run \`glab-axi${repoFlag(c)} ${c.action} list\` for the same ${c.action === "mr" ? "merge requests" : "issues"} as structured output`,
    ],
  },
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
        .map((line) => appendHostnameFlag(line));
    }
  }
  return [];
}
