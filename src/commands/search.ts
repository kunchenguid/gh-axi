import type { RepoContext } from "../context.js";
import { ghJson } from "../gh.js";
import { AxiError } from "../errors.js";
import { getFlag, hasFlag, rejectUnknownFlags } from "../args.js";
import {
  field,
  boolYesNo,
  lower,
  pluck,
  relativeTime,
  joinArray,
  custom,
  extract,
  renderList,
  renderHelp,
  renderOutput,
  renderError,
  type FieldDef,
} from "../toon.js";
import { formatCountLine } from "../format.js";
import { getSuggestions } from "../suggestions.js";
import { parseFields, type ExtraFieldSpec } from "../fields.js";

const DEFAULT_SEARCH_LIMIT = "1000";
const DISPLAY_LIMIT = 30;
const SEARCH_VALUE_FLAGS = new Set([
  "--repo",
  "--owner",
  "--state",
  "--label",
  "--assignee",
  "--author",
  "--sort",
  "--limit",
  "--review",
  "--language",
  "--stars",
  "--fields",
]);

export const SEARCH_FLAGS: Record<string, readonly string[]> = {
  issues: [
    "--repo",
    "--owner",
    "--state",
    "--label",
    "--assignee",
    "--author",
    "--sort",
    "--limit",
    "--fields",
  ],
  prs: [
    "--repo",
    "--owner",
    "--state",
    "--label",
    "--assignee",
    "--author",
    "--sort",
    "--limit",
    "--draft",
    "--review",
    "--fields",
  ],
  repos: ["--repo", "--owner", "--language", "--stars", "--sort", "--limit"],
  commits: ["--repo", "--owner", "--author", "--sort", "--limit"],
  code: ["--repo", "--owner", "--language", "--limit"],
};

export const SEARCH_HELP = `usage: gh-axi search <type> <query> [flags]
types[5]:
  issues, prs, repos, commits, code
flags{common}:
  --repo, --owner, --state, --label, --assignee, --author, --sort, --limit <n> (default 1000)
flags{issues}:
  --fields <a,b,c> (extra columns: assignees, authorAssociation, body, closedAt, commentsCount, isLocked, updatedAt, url)
flags{prs}:
  --draft, --review, --fields <a,b,c> (extra columns: the issues set plus isDraft, labels)
flags{repos}:
  --language, --stars (e.g. ">100")
flags{code}:
  --language
examples:
  gh-axi search issues "login bug" --repo octo/repo --state open
  gh-axi search prs "feat" --author alice --sort updated
  gh-axi search prs "feat" --owner octo --fields updatedAt,url
  gh-axi search repos "cli tool" --language Go --stars ">50"`;

const issueSchema: FieldDef[] = [
  field("number"),
  field("title"),
  pluck("repository", "nameWithOwner", "repo"),
  lower("state"),
  pluck("author", "login", "author"),
  joinArray("labels", "name", "labels"),
  relativeTime("createdAt", "created"),
];

// Extra columns for --fields, limited to what `gh search issues|prs --json`
// returns. Fields already in the default schema are not repeated here.
const SEARCH_ISSUE_EXTRA_FIELDS: Record<string, ExtraFieldSpec> = {
  assignees: {
    jsonKey: "assignees",
    def: joinArray("assignees", "login", "assignees"),
  },
  authorAssociation: {
    jsonKey: "authorAssociation",
    def: lower("authorAssociation", "author_association"),
  },
  body: { jsonKey: "body", def: field("body") },
  closedAt: {
    jsonKey: "closedAt",
    // gh search reports an open item's closedAt as Go's zero time
    // (0001-01-01T00:00:00Z) rather than null.
    def: custom("closed_at", (item) => {
      const closedAt = item.closedAt;
      if (typeof closedAt !== "string" || closedAt.startsWith("0001-"))
        return "none";
      return extract(item, [relativeTime("closedAt", "closed_at")]).closed_at;
    }),
  },
  commentsCount: {
    jsonKey: "commentsCount",
    def: field("commentsCount", "comments"),
  },
  isLocked: { jsonKey: "isLocked", def: boolYesNo("isLocked", "locked") },
  updatedAt: {
    jsonKey: "updatedAt",
    def: relativeTime("updatedAt", "updated_at"),
  },
  url: { jsonKey: "url", def: field("url") },
};

const SEARCH_PR_EXTRA_FIELDS: Record<string, ExtraFieldSpec> = {
  ...SEARCH_ISSUE_EXTRA_FIELDS,
  isDraft: { jsonKey: "isDraft", def: boolYesNo("isDraft", "draft") },
  labels: { jsonKey: "labels", def: joinArray("labels", "name", "labels") },
};

function withExtraJson(base: string, extraJsonKeys: string[]): string {
  return extraJsonKeys.length > 0 ? base + "," + extraJsonKeys.join(",") : base;
}

const prSchema: FieldDef[] = [
  field("number"),
  field("title"),
  pluck("repository", "nameWithOwner", "repo"),
  lower("state"),
  pluck("author", "login", "author"),
  relativeTime("createdAt", "created"),
];

const repoSchema: FieldDef[] = [
  field("fullName", "name"),
  field("description"),
  field("stargazersCount", "stars"),
  field("forksCount", "forks"),
  field("language"),
  relativeTime("updatedAt", "updated"),
];

const commitSchema: FieldDef[] = [
  field("sha"),
  custom("message", (item) => {
    const commit = item.commit as Record<string, unknown> | undefined;
    const message = commit?.message;
    return typeof message === "string" ? message.split("\n")[0] : "";
  }),
  pluck("repository", "fullName", "repo"),
  pluck("author", "login", "author"),
  custom("date", (item) => {
    const commit = item.commit as Record<string, unknown> | undefined;
    const author = commit?.author as Record<string, unknown> | undefined;
    const d = author?.date;
    if (!d || typeof d !== "string") return "unknown";
    const diffMs = Date.now() - new Date(d).getTime();
    const diffH = Math.floor(diffMs / 3600000);
    if (diffH < 1) return "just now";
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    return `${diffD}d ago`;
  }),
];

function extractQuery(args: string[]): string[] {
  // Collect positional args (not flags and not the subcommand). Forward them to
  // gh as separate argv entries: gh quotes a multi-word argument whose first
  // token is a qualifier (`"a:b c:d"` -> `a:"b c:d"`), so joining
  // `review-requested:@me created:>=2026-01-01` into one string breaks it.
  const positionals: string[] = [];
  let i = 1; // skip subcommand (issues/prs/repos/commits/code)
  while (i < args.length) {
    if (args[i].startsWith("--")) {
      i += args[i].includes("=") || !SEARCH_VALUE_FLAGS.has(args[i]) ? 1 : 2;
    } else {
      if (args[i].trim() !== "") positionals.push(args[i]);
      i++;
    }
  }
  return positionals;
}

// gh splits each query argument at its first colon and quotes only what
// follows, so an argument is a scope when the last whitespace-separated token
// before that colon is org, user or repo. GitHub ignores uppercase qualifiers.
const SCOPE_QUALIFIER = /^(?:[^:]*\s)?(?:org|user|repo):/;

function getSearchRepo(
  args: string[],
  query: string[],
  ctx?: RepoContext,
): string | undefined {
  const repo = getFlag(args, "--repo");
  if (repo !== undefined) return repo;
  if (ctx?.source === "flag") return ctx.nwo; // explicit -R
  // The ambient repo (cwd origin or GH_REPO) is only a default. Next to a scope
  // the caller gave, GitHub ANDs, ORs or rejects it, so leave it out then.
  if (getFlag(args, "--owner") || query.some((q) => SCOPE_QUALIFIER.test(q)))
    return undefined;
  return ctx?.nwo;
}

const COMMON_FILTER_FLAGS = [
  "--repo",
  "--owner",
  "--state",
  "--label",
  "--assignee",
  "--author",
];

function hasSearchFilters(args: string[], extraFlags: string[] = []): boolean {
  return [...COMMON_FILTER_FLAGS, ...extraFlags].some(
    (f) => hasFlag(args, f) || getFlag(args, f) !== undefined,
  );
}

async function searchIssues(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const { extraDefs, extraJsonKeys } = parseFields(
    getFlag(args, "--fields"),
    SEARCH_ISSUE_EXTRA_FIELDS,
  );
  const query = extractQuery(args);
  if (query.length === 0 && !hasSearchFilters(args))
    throw new AxiError(
      "Search query or filters required: gh-axi search issues <query> [--assignee x] [--state open] ...",
      "VALIDATION_ERROR",
    );

  const limit = getFlag(args, "--limit") ?? DEFAULT_SEARCH_LIMIT;
  const ghArgs = ["search", "issues"];
  ghArgs.push(
    "--json",
    withExtraJson(
      "number,title,repository,state,author,labels,createdAt",
      extraJsonKeys,
    ),
    "--limit",
    limit,
  );
  const repo = getSearchRepo(args, query, ctx);
  if (repo) ghArgs.push("--repo", repo);
  const owner = getFlag(args, "--owner");
  if (owner) ghArgs.push("--owner", owner);
  const state = getFlag(args, "--state");
  if (state) ghArgs.push("--state", state);
  const label = getFlag(args, "--label");
  if (label) ghArgs.push("--label", label);
  const assignee = getFlag(args, "--assignee");
  if (assignee) ghArgs.push("--assignee", assignee);
  const author = getFlag(args, "--author");
  if (author) ghArgs.push("--author", author);
  const sort = getFlag(args, "--sort");
  if (sort) ghArgs.push("--sort", sort);

  if (query.length > 0) ghArgs.push("--", ...query);
  const results = await ghJson<Record<string, unknown>[]>(ghArgs);
  const limitNum = parseInt(limit, 10);
  const displayed = results.slice(0, DISPLAY_LIMIT);
  const countLine = formatCountLine({
    count: results.length,
    limit: limitNum,
    apiLimitHit: results.length === limitNum,
    displayLimit: DISPLAY_LIMIT,
  });
  const suggestions = getSuggestions({
    domain: "search",
    action: "issues",
    repo: ctx,
  });
  return renderOutput([
    countLine,
    renderList("issues", displayed, [...issueSchema, ...extraDefs]),
    renderHelp(suggestions),
  ]);
}

async function searchPrs(args: string[], ctx?: RepoContext): Promise<string> {
  const { extraDefs, extraJsonKeys } = parseFields(
    getFlag(args, "--fields"),
    SEARCH_PR_EXTRA_FIELDS,
  );
  const query = extractQuery(args);
  if (query.length === 0 && !hasSearchFilters(args, ["--draft", "--review"]))
    throw new AxiError(
      "Search query or filters required: gh-axi search prs <query> [--assignee x] [--state open] ...",
      "VALIDATION_ERROR",
    );

  const limit = getFlag(args, "--limit") ?? DEFAULT_SEARCH_LIMIT;
  const ghArgs = ["search", "prs"];
  ghArgs.push(
    "--json",
    withExtraJson(
      "number,title,repository,state,author,createdAt",
      extraJsonKeys,
    ),
    "--limit",
    limit,
  );
  const repo = getSearchRepo(args, query, ctx);
  if (repo) ghArgs.push("--repo", repo);
  const owner = getFlag(args, "--owner");
  if (owner) ghArgs.push("--owner", owner);
  const state = getFlag(args, "--state");
  if (state) ghArgs.push("--state", state);
  const label = getFlag(args, "--label");
  if (label) ghArgs.push("--label", label);
  const assignee = getFlag(args, "--assignee");
  if (assignee) ghArgs.push("--assignee", assignee);
  const author = getFlag(args, "--author");
  if (author) ghArgs.push("--author", author);
  const sort = getFlag(args, "--sort");
  if (sort) ghArgs.push("--sort", sort);
  if (hasFlag(args, "--draft")) ghArgs.push("--draft");
  const review = getFlag(args, "--review");
  if (review) ghArgs.push("--review", review);

  if (query.length > 0) ghArgs.push("--", ...query);
  const results = await ghJson<Record<string, unknown>[]>(ghArgs);
  const limitNum = parseInt(limit, 10);
  const displayed = results.slice(0, DISPLAY_LIMIT);
  const countLine = formatCountLine({
    count: results.length,
    limit: limitNum,
    apiLimitHit: results.length === limitNum,
    displayLimit: DISPLAY_LIMIT,
  });
  const suggestions = getSuggestions({
    domain: "search",
    action: "prs",
    repo: ctx,
  });
  return renderOutput([
    countLine,
    renderList("prs", displayed, [...prSchema, ...extraDefs]),
    renderHelp(suggestions),
  ]);
}

async function searchRepos(args: string[], ctx?: RepoContext): Promise<string> {
  const query = extractQuery(args);
  if (query.length === 0 && !hasSearchFilters(args, ["--language", "--stars"]))
    throw new AxiError(
      "Search query or filters required: gh-axi search repos <query> [--owner x] [--language y] ...",
      "VALIDATION_ERROR",
    );

  const limit = getFlag(args, "--limit") ?? DEFAULT_SEARCH_LIMIT;
  const ghArgs = ["search", "repos"];
  ghArgs.push(
    "--json",
    "fullName,description,stargazersCount,forksCount,language,updatedAt",
    "--limit",
    limit,
  );
  const owner = getFlag(args, "--owner");
  if (owner) ghArgs.push("--owner", owner);
  const language = getFlag(args, "--language");
  if (language) ghArgs.push("--language", language);
  const stars = getFlag(args, "--stars");
  if (stars) ghArgs.push("--stars", stars);
  const sort = getFlag(args, "--sort");
  if (sort) ghArgs.push("--sort", sort);

  if (query.length > 0) ghArgs.push("--", ...query);
  const results = await ghJson<Record<string, unknown>[]>(ghArgs);
  const limitNum = parseInt(limit, 10);
  const displayed = results.slice(0, DISPLAY_LIMIT);
  const countLine = formatCountLine({
    count: results.length,
    limit: limitNum,
    apiLimitHit: results.length === limitNum,
    displayLimit: DISPLAY_LIMIT,
  });
  const suggestions = getSuggestions({
    domain: "search",
    action: "repos",
    repo: ctx,
  });
  return renderOutput([
    countLine,
    renderList("repos", displayed, repoSchema),
    renderHelp(suggestions),
  ]);
}

async function searchCommits(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const query = extractQuery(args);
  if (query.length === 0 && !hasSearchFilters(args))
    throw new AxiError(
      "Search query or filters required: gh-axi search commits <query> [--repo x] [--author y] ...",
      "VALIDATION_ERROR",
    );

  const limit = getFlag(args, "--limit") ?? DEFAULT_SEARCH_LIMIT;
  const ghArgs = ["search", "commits"];
  ghArgs.push("--json", "sha,commit,repository,author", "--limit", limit);
  const repo = getSearchRepo(args, query, ctx);
  if (repo) ghArgs.push("--repo", repo);
  const owner = getFlag(args, "--owner");
  if (owner) ghArgs.push("--owner", owner);
  const author = getFlag(args, "--author");
  if (author) ghArgs.push("--author", author);
  const sort = getFlag(args, "--sort");
  if (sort) ghArgs.push("--sort", sort);

  if (query.length > 0) ghArgs.push("--", ...query);
  const results = await ghJson<Record<string, unknown>[]>(ghArgs);
  const limitNum = parseInt(limit, 10);
  const displayed = results.slice(0, DISPLAY_LIMIT);
  const countLine = formatCountLine({
    count: results.length,
    limit: limitNum,
    apiLimitHit: results.length === limitNum,
    displayLimit: DISPLAY_LIMIT,
  });
  const suggestions = getSuggestions({
    domain: "search",
    action: "commits",
    repo: ctx,
  });
  return renderOutput([
    countLine,
    renderList("commits", displayed, commitSchema),
    renderHelp(suggestions),
  ]);
}

const codeSchema: FieldDef[] = [
  field("path"),
  pluck("repository", "nameWithOwner", "repo"),
  custom("matches", (item) => {
    const tm = item.textMatches;
    if (!Array.isArray(tm) || tm.length === 0) return 0;
    return tm.length;
  }),
];

async function searchCode(args: string[], ctx?: RepoContext): Promise<string> {
  const query = extractQuery(args);
  if (query.length === 0 && !hasSearchFilters(args, ["--language"]))
    throw new AxiError(
      "Search query or filters required: gh-axi search code <query> [--repo x] [--language y] ...",
      "VALIDATION_ERROR",
    );

  const limit = getFlag(args, "--limit") ?? DEFAULT_SEARCH_LIMIT;
  const ghArgs = ["search", "code"];
  ghArgs.push("--json", "path,repository,textMatches", "--limit", limit);
  const repo = getSearchRepo(args, query, ctx);
  if (repo) ghArgs.push("--repo", repo);
  const owner = getFlag(args, "--owner");
  if (owner) ghArgs.push("--owner", owner);
  const language = getFlag(args, "--language");
  if (language) ghArgs.push("--language", language);

  if (query.length > 0) ghArgs.push("--", ...query);
  const results = await ghJson<Record<string, unknown>[]>(ghArgs);
  const limitNum = parseInt(limit, 10);
  const displayed = results.slice(0, DISPLAY_LIMIT);
  const countLine = formatCountLine({
    count: results.length,
    limit: limitNum,
    apiLimitHit: results.length === limitNum,
    displayLimit: DISPLAY_LIMIT,
  });
  const suggestions = getSuggestions({
    domain: "search",
    action: "code",
    repo: ctx,
  });
  return renderOutput([
    countLine,
    renderList("results", displayed, codeSchema),
    renderHelp(suggestions),
  ]);
}

export async function searchCommand(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const sub = args[0];

  if (sub === "--help" || sub === undefined) return SEARCH_HELP;

  switch (sub) {
    case "issues":
      rejectUnknownFlags(
        args.slice(1),
        SEARCH_FLAGS.issues,
        "search",
        "issues",
      );
      return searchIssues(args, ctx);
    case "prs":
      rejectUnknownFlags(args.slice(1), SEARCH_FLAGS.prs, "search", "prs");
      return searchPrs(args, ctx);
    case "repos":
      rejectUnknownFlags(args.slice(1), SEARCH_FLAGS.repos, "search", "repos");
      return searchRepos(args, ctx);
    case "commits":
      rejectUnknownFlags(
        args.slice(1),
        SEARCH_FLAGS.commits,
        "search",
        "commits",
      );
      return searchCommits(args, ctx);
    case "code":
      rejectUnknownFlags(args.slice(1), SEARCH_FLAGS.code, "search", "code");
      return searchCode(args, ctx);
    default:
      return renderError(`Unknown search type: ${sub}`, "VALIDATION_ERROR", [
        "Available types: issues, prs, repos, commits, code",
      ]);
  }
}
