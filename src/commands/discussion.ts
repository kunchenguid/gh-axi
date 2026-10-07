import type { RepoContext } from "../context.js";
import { ghJson, ghExec } from "../gh.js";
import { AxiError } from "../errors.js";
import { getSuggestions } from "../suggestions.js";
import {
  hasFlag,
  getAllFlags,
  getPositional,
  pushRepeated,
  takeBoolFlag,
  takeRequiredFlag,
  rejectUnknownFlags,
} from "../args.js";
import { takeBody, truncateBody } from "../body.js";
import { formatCountLine } from "../format.js";
import {
  field,
  pluck,
  relativeTime,
  custom,
  extract,
  renderList,
  renderHelp,
  renderError,
  renderOutput,
  type FieldDef,
} from "../toon.js";
import { encode } from "@toon-format/toon";

// `gh discussion` is a preview command family (checked on gh 2.100.0). This
// wrapper stays a thin reshape of what `gh discussion ... --json` returns; it
// never issues its own GraphQL.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiscussionAuthor {
  login?: string;
}

interface DiscussionReply {
  [key: string]: unknown;
  author?: DiscussionAuthor | null;
  body?: string;
  createdAt?: string;
  url?: string;
  isAnswer?: boolean;
}

interface DiscussionComment extends DiscussionReply {
  replies?: { totalCount?: number; nodes?: DiscussionReply[] };
}

interface DiscussionView {
  [key: string]: unknown;
  number?: number;
  title?: string;
  body?: string;
  state?: string;
  url?: string;
  answered?: boolean;
  category?: { name?: string; isAnswerable?: boolean } | null;
  comments?: { totalCount?: number; nodes?: DiscussionComment[] };
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

export const DISCUSSION_HELP = `usage: gh-axi discussion <subcommand> [flags]
subcommands[3]:
  list, view <number|url|comment-url>, comment <number|url|comment-url>
flags{list}:
  --state <open|closed|all> (default open), --category <name>, --author <login>, --label <name> (repeatable), --limit <n> (default 30)
flags{view}:
  --comments (each top-level comment with its replies nested under it), --limit <n> (comments to fetch, default 30; with a comment-url, replies to fetch), --order <newest|oldest> (which end to fetch when there are more than --limit; output is always oldest first), --full (show complete bodies without truncation)
flags{comment}:
  --body <text> or --body-file <path> (required; "-" reads stdin)
notes:
  comment with a discussion number or url adds a top-level comment; comment with a comment-url posts a reply under that comment
  view --comments shows only the latest few replies per comment; reply_count and replies_hidden say when some are hidden, and view <comment-url> shows the full reply thread
  gh discussion is a preview gh command and may change
examples:
  gh-axi discussion list --category General
  gh-axi discussion view 66 --comments
  gh-axi discussion view 'https://github.com/OWNER/REPO/discussions/66#discussioncomment-456'
  gh-axi discussion comment 66 --body "Thanks for the update"
  gh-axi discussion comment 'https://github.com/OWNER/REPO/discussions/66#discussioncomment-456' --body-file reply.md`;

export const DISCUSSION_FLAGS: Record<string, readonly string[]> = {
  list: ["--state", "--category", "--author", "--label", "--limit"],
  view: ["--comments", "--limit", "--order", "--full"],
  comment: ["--body", "--body-file"],
};

// ---------------------------------------------------------------------------
// Field schemas
// ---------------------------------------------------------------------------

const listSchema: FieldDef[] = [
  field("number"),
  field("title"),
  custom("state", (item: Record<string, unknown>) =>
    item.closed ? "closed" : "open",
  ),
  pluck("category", "name", "category"),
  pluck("author", "login", "author"),
  relativeTime("updatedAt", "updated"),
];

const DISCUSSION_BODY_MAX = 500;
const COMMENT_BODY_MAX = 800;

function bodyField(max: number, full: boolean): FieldDef {
  return custom("body", (item: Record<string, unknown>) =>
    full
      ? typeof item.body === "string"
        ? item.body
        : ""
      : truncateBody(item.body, max),
  );
}

function replySchema(full: boolean): FieldDef[] {
  return [
    pluck("author", "login", "author"),
    relativeTime("createdAt", "created"),
    field("url"),
    bodyField(COMMENT_BODY_MAX, full),
  ];
}

// ---------------------------------------------------------------------------
// Target parsing
// ---------------------------------------------------------------------------

const COMMENT_URL_RE = /\/discussions\/\d+#discussioncomment-\d+$/;
const DISCUSSION_URL_RE = /^https?:\/\/[^\s]+\/discussions\/\d+\/?$/;

/**
 * Accept what `gh discussion view/comment` accepts: a number, a discussion
 * URL, a comment URL, or a comment node ID (`DC_...`). A leading `#` on a
 * number is tolerated. Anything else fails here instead of in `gh`.
 */
function parseTarget(
  raw: string | undefined,
  sub: string,
): { target: string; isComment: boolean } {
  if (!raw) {
    throw new AxiError(
      `Missing discussion number or URL: gh-axi discussion ${sub} <number|url|comment-url>`,
      "VALIDATION_ERROR",
    );
  }
  const value = raw.replace(/^#(?=\d+$)/, "");
  if (/^\d+$/.test(value) || DISCUSSION_URL_RE.test(value)) {
    return { target: value, isComment: false };
  }
  if (COMMENT_URL_RE.test(value) || /^DC_[A-Za-z0-9_-]+$/.test(value)) {
    return { target: value, isComment: true };
  }
  throw new AxiError(
    `Invalid discussion target: ${raw}. Pass a discussion number, a discussion URL, or a comment URL`,
    "VALIDATION_ERROR",
  );
}

/**
 * The repo a discussion/comment URL points at, so follow-up hints scope to it
 * instead of the checkout. Falls back to ctx when there is no URL.
 */
function repoOfUrl(
  url: string | undefined,
  ctx?: RepoContext,
): RepoContext | undefined {
  const m = url?.match(/^https?:\/\/[^/]+\/([^/]+)\/([^/]+)\/discussions\/\d+/);
  if (!m) return ctx;
  const nwo = `${m[1]}/${m[2]}`;
  if (ctx?.nwo.toLowerCase() === nwo.toLowerCase()) return ctx;
  return { owner: m[1], name: m[2], nwo, source: "flag", host: ctx?.host };
}

/** The discussion number from a discussion/comment URL, or the number itself. */
function discussionNumberOf(target: string): string | undefined {
  if (/^\d+$/.test(target)) return target;
  return target.match(/\/discussions\/(\d+)/)?.[1];
}

function parseLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    throw new AxiError(
      `--limit must be a positive integer, got "${raw}"`,
      "VALIDATION_ERROR",
    );
  }
  return Number(raw);
}

function chronological<T extends { createdAt?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    (a.createdAt ?? "").localeCompare(b.createdAt ?? ""),
  );
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

async function listDiscussions(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const state = takeRequiredFlag(args, "--state");
  const category = takeRequiredFlag(args, "--category");
  const author = takeRequiredFlag(args, "--author");
  const labels = getAllFlags(args, "--label");
  const limit = parseLimit(takeRequiredFlag(args, "--limit")) ?? 30;

  const ghArgs = [
    "discussion",
    "list",
    "--json",
    "number,title,closed,category,author,updatedAt",
    "--limit",
    String(limit),
  ];
  if (state) ghArgs.push("--state", state);
  if (category) ghArgs.push("--category", category);
  if (author) ghArgs.push("--author", author);
  pushRepeated(ghArgs, "--label", labels);

  // gh wraps the list as {discussions, totalCount, next}.
  const result = await ghJson<
    | { discussions?: Record<string, unknown>[]; totalCount?: number }
    | Record<string, unknown>[]
  >(ghArgs, ctx);
  const items = Array.isArray(result) ? result : (result.discussions ?? []);
  const totalCount = Array.isArray(result) ? undefined : result.totalCount;
  const help = getSuggestions({
    domain: "discussion",
    action: "list",
    isEmpty: items.length === 0,
    repo: ctx,
  });
  return renderOutput([
    formatCountLine({ count: items.length, limit, totalCount }),
    renderList("discussions", items, listSchema),
    renderHelp(help),
  ]);
}

/** Reshape one top-level comment, nesting its replies oldest first. */
function shapeComment(
  comment: DiscussionComment,
  full: boolean,
): Record<string, unknown> {
  const replies = chronological(comment.replies?.nodes ?? []);
  const replyCount = comment.replies?.totalCount ?? replies.length;
  const shaped: Record<string, unknown> = extract(comment, replySchema(full));
  if (comment.isAnswer) shaped.answer = true;
  shaped.reply_count = replyCount;
  if (replyCount > replies.length) {
    shaped.replies_hidden = replyCount - replies.length;
  }
  if (replies.length > 0) {
    shaped.replies = replies.map((r) => extract(r, replySchema(full)));
  }
  return shaped;
}

async function viewDiscussion(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const limit = parseLimit(takeRequiredFlag(args, "--limit"));
  const order = takeRequiredFlag(args, "--order");
  if (order !== undefined && order !== "newest" && order !== "oldest") {
    throw new AxiError(
      `--order must be newest or oldest, got "${order}"`,
      "VALIDATION_ERROR",
    );
  }
  const full = takeBoolFlag(args, "--full");
  const withCommentsFlag = takeBoolFlag(args, "--comments");
  const { target, isComment } = parseTarget(getPositional(args, 1), "view");
  // A comment target always shows that comment's reply thread.
  const withComments = withCommentsFlag || isComment;

  if (!withComments && (limit !== undefined || order !== undefined)) {
    throw new AxiError(
      "--limit and --order need --comments or a comment-url target",
      "VALIDATION_ERROR",
    );
  }

  const ghArgs = [
    "discussion",
    "view",
    target,
    "--json",
    "number,title,body,state,author,category,answered,createdAt,url,comments",
  ];
  // Without --comments, fetch a single comment only for its totalCount.
  ghArgs.push("--limit", String(withComments ? (limit ?? 30) : 1));
  if (order) ghArgs.push("--order", order);

  const item = await ghJson<DiscussionView>(ghArgs, ctx);
  const repo = repoOfUrl(item.url ?? target, ctx);
  const number = item.number ?? discussionNumberOf(target);
  const comments = item.comments?.nodes ?? [];
  const commentCount = item.comments?.totalCount ?? comments.length;

  const detail: Record<string, unknown> = {
    number: item.number ?? null,
    ...(repo ? { repo: repo.nwo } : {}),
    title: item.title ?? null,
    state: typeof item.state === "string" ? item.state.toLowerCase() : null,
    category: item.category?.name ?? null,
    ...(item.category?.isAnswerable
      ? { answered: item.answered ? "yes" : "no" }
      : {}),
    ...extract(item, [
      pluck("author", "login", "author"),
      relativeTime("createdAt", "created"),
    ]),
    url: item.url ?? null,
    comment_count: commentCount,
  };
  if (withComments && !isComment && commentCount > comments.length) {
    detail.comments_hidden = commentCount - comments.length;
  }
  Object.assign(detail, extract(item, [bodyField(DISCUSSION_BODY_MAX, full)]));

  const blocks: string[] = [encode({ discussion: detail })];
  const help: string[] = [];

  if (withComments) {
    const shaped = chronological(comments).map((c) => shapeComment(c, full));
    blocks.push(encode({ comments: shaped }));

    if (!isComment && commentCount > comments.length) {
      help.push(
        ...getSuggestions({
          domain: "discussion",
          action: "comments-hidden",
          id: target,
          count: commentCount,
          repo,
        }),
      );
    }
    for (const c of shaped.filter((s) => s.replies_hidden !== undefined)) {
      help.push(
        ...getSuggestions({
          domain: "discussion",
          action: isComment ? "thread-replies-hidden" : "replies-hidden",
          id: typeof c.url === "string" ? c.url : target,
          count: c.reply_count as number,
          repo,
        }),
      );
    }
  }

  help.push(
    ...getSuggestions({
      domain: "discussion",
      action: withComments ? "view-comments" : "view",
      id: number,
      count: commentCount,
      repo,
    }),
  );

  blocks.push(renderHelp(help));
  return renderOutput(blocks);
}

async function commentOnDiscussion(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const body = takeBody(args, {
    required: true,
    label: "comment body",
  });
  const { target, isComment } = parseTarget(getPositional(args, 1), "comment");

  const stdout = await ghExec(
    ["discussion", "comment", target, "--body", body],
    ctx,
  );
  const url =
    stdout.match(/https?:\/\/\S+#discussioncomment-\d+/)?.[0] ?? stdout.trim();

  const help = getSuggestions({
    domain: "discussion",
    action: "comment",
    id: discussionNumberOf(url) ?? discussionNumberOf(target),
    repo: repoOfUrl(url, repoOfUrl(target, ctx)),
  });
  return renderOutput([
    encode({
      comment: {
        created: isComment ? "reply" : "comment",
        target,
        url,
      },
    }),
    renderHelp(help),
  ]);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function discussionCommand(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const sub = args[0];

  if (!sub || hasFlag(args, "--help")) return DISCUSSION_HELP;

  switch (sub) {
    case "list":
      rejectUnknownFlags(
        args.slice(1),
        DISCUSSION_FLAGS.list,
        "discussion",
        "list",
      );
      return listDiscussions(args, ctx);
    case "view":
      rejectUnknownFlags(
        args.slice(1),
        DISCUSSION_FLAGS.view,
        "discussion",
        "view",
      );
      return viewDiscussion(args, ctx);
    case "comment":
      rejectUnknownFlags(
        args.slice(1),
        DISCUSSION_FLAGS.comment,
        "discussion",
        "comment",
      );
      return commentOnDiscussion(args, ctx);
    default:
      return renderError(
        `Unknown discussion subcommand: ${sub}`,
        "VALIDATION_ERROR",
        ["Run `gh-axi discussion --help` for usage"],
      );
  }
}
