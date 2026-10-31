import { encode } from "@toon-format/toon";
import type { RepoContext } from "../context.js";
import {
  ghJson,
  ghExec,
  ghExecWithAttachmentState,
  ensureAttachmentSupport,
  ghRaw,
} from "../gh.js";
import {
  AttachmentMutationError,
  AxiError,
  MutationFollowupError,
} from "../errors.js";
import { takeBody, truncateBody } from "../body.js";
import { fetchCreatedComment } from "../comment.js";
import {
  ATTACH_BODY_OPTIONS,
  attachBodyOptions,
  collectAttachments,
  hasAttachmentFlag,
  newAttachmentUrls,
  pushAttachments,
  preserveAttachMutation,
  renderAttachOutput,
} from "../attach.js";
import { formatCountLine } from "../format.js";
import { fetchListTotal, type ListFilter } from "../totals.js";
import { getSuggestions, repoTargetFlags } from "../suggestions.js";
import {
  takeFlag,
  takeRequiredFlag,
  takeSingleRequiredFlag,
  takeBoolFlag,
  takeNumber,
  takeAllFlags,
  pushRepeated,
  rejectUnknownFlags,
} from "../args.js";
import { parseFields, type ExtraFieldSpec } from "../fields.js";
import {
  field,
  pluck,
  lower,
  boolYesNo,
  mapEnum,
  relativeTime,
  joinArray,
  custom,
  renderList,
  renderDetail,
  renderHelp,
  renderError,
  renderOutput,
  type FieldDef,
} from "../toon.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One entry of `pr view --json statusCheckRollup`. The rollup is a union of two
 * shapes: a CheckRun (GitHub Actions et al.) reports its verdict in
 * `conclusion`, while a legacy commit StatusContext has no `conclusion` at all
 * and reports its verdict in `state`.
 */
interface StatusCheck {
  /** CheckRun: the check run name. */
  name?: string;
  /** StatusContext: the commit status context name. */
  context?: string;
  /** CheckRun: SUCCESS | FAILURE | SKIPPED | …; absent while still running. */
  conclusion?: string;
  /** StatusContext: SUCCESS | PENDING | FAILURE | ERROR | EXPECTED. */
  state?: string;
  /** CheckRun: QUEUED | IN_PROGRESS | COMPLETED. Carries no verdict. */
  status?: string;
  /** CheckRun: the workflow the run belongs to; part of its identity. */
  workflowName?: string;
  /** ISO time the run started; absent or zero while still queued. */
  startedAt?: string;
}

interface PrComment {
  author?: { login: string };
  body?: string;
  createdAt?: string;
}

interface PrItem {
  number: number;
  title: string;
  state: string;
  author: { login: string };
  isDraft: boolean;
  reviewDecision: string;
  mergedAt?: string;
  /** CLEAN | DIRTY | BEHIND | BLOCKED | UNSTABLE | HAS_HOOKS | DRAFT | UNKNOWN */
  mergeStateStatus?: string;
  statusCheckRollup?: StatusCheck[];
  body?: string;
  comments?: PrComment[];
  reviews?: unknown[];
  mergedBy?: { login: string };
}

interface PrReview {
  id: number;
  user?: { login: string };
  body?: string;
  state?: string;
  submitted_at?: string;
}

interface PrReviewComment {
  pull_request_review_id?: number;
  user?: { login: string };
  path?: string;
  line?: number | null;
  original_line?: number | null;
  body?: string;
  created_at?: string;
}

interface RevertResult {
  number?: number;
  html_url?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Classify a status check into a simple status category. */
function classifyCheck(
  c: StatusCheck,
): "pass" | "fail" | "skip" | "pending" | "cancel" {
  const conc = (c.conclusion ?? "").toUpperCase();
  if (conc === "SUCCESS" || conc === "NEUTRAL") return "pass";
  if (
    conc === "FAILURE" ||
    conc === "TIMED_OUT" ||
    conc === "ACTION_REQUIRED" ||
    conc === "STARTUP_FAILURE"
  )
    return "fail";
  if (conc === "SKIPPED") return "skip";
  // gh pr checks buckets CANCELLED separately from failures: a cancelled run
  // delivered no verdict about the code, so it is not a failure.
  if (conc === "CANCELLED") return "cancel";
  // STALE (and anything else unrecognized) means the result does not apply to
  // the current head yet - pending, matching gh's default bucket.
  if (conc) return "pending";

  // No conclusion: either a StatusContext, whose verdict lives in `state`, or a
  // CheckRun that has not finished yet — a CheckRun's `status` (QUEUED /
  // IN_PROGRESS / COMPLETED) never carries a verdict, so it stays pending.
  const state = (c.state ?? "").toUpperCase();
  if (state === "SUCCESS") return "pass";
  if (state === "FAILURE" || state === "ERROR") return "fail";
  if (state === "EXPECTED" || state === "NEUTRAL") return "skip";
  return "pending";
}

/** Start time for ordering; a run not started yet counts as the newest. */
function checkStartMs(c: StatusCheck): number {
  const t = Date.parse(c.startedAt ?? "");
  return Number.isNaN(t) || t <= 0 ? Infinity : t;
}

/**
 * Keep only the latest run of each check, like gh's `eliminateDuplicates`:
 * a re-run supersedes the earlier run of the same check, so a passing re-run
 * hides the failure it replaced. A status context is keyed by its context, a
 * check run by name plus workflow.
 */
function latestChecks(checks: StatusCheck[]): StatusCheck[] {
  const key = (c: StatusCheck) =>
    c.context
      ? `context:${c.context}`
      : `check:${JSON.stringify([c.name ?? "", c.workflowName ?? ""])}`;
  const latest = new Map<string, StatusCheck>();
  for (const c of checks) {
    const prev = latest.get(key(c));
    if (!prev || checkStartMs(c) > checkStartMs(prev)) latest.set(key(c), c);
  }
  return checks.filter((c) => latest.get(key(c)) === c);
}

interface CheckCounts {
  passed: number;
  failed: number;
  skipped: number;
  cancelled: number;
  pending: number;
  total: number;
}

function countChecks(checks: StatusCheck[]): CheckCounts {
  const counts: CheckCounts = {
    passed: 0,
    failed: 0,
    skipped: 0,
    cancelled: 0,
    pending: 0,
    total: checks.length,
  };
  for (const c of checks) {
    const bucket = classifyCheck(c);
    if (bucket === "pass") counts.passed++;
    else if (bucket === "fail") counts.failed++;
    else if (bucket === "skip") counts.skipped++;
    else if (bucket === "cancel") counts.cancelled++;
    else counts.pending++;
  }
  return counts;
}

function checksSummary(counts: CheckCounts): string {
  const parts = [`${counts.passed} passed`, `${counts.failed} failed`];
  if (counts.skipped > 0) parts.push(`${counts.skipped} skipped`);
  if (counts.cancelled > 0) parts.push(`${counts.cancelled} cancelled`);
  if (counts.pending > 0) parts.push(`${counts.pending} pending`);
  parts.push(`${counts.total} total`);
  return parts.join(", ");
}

// An empty rollup only says GitHub has no check results for the head commit
// yet. Workflows may still be queued or awaiting approval, so do not claim the
// repo has no CI configured.
const NO_CHECKS_SUMMARY =
  "0 passed, 0 failed, no check results reported for the PR head commit";

function prRestPath(
  ctx: RepoContext | undefined,
  num: number,
  suffix: string,
): string {
  const repoPath = ctx
    ? `repos/${ctx.owner}/${ctx.name}`
    : "repos/{owner}/{repo}";
  return `${repoPath}/pulls/${num}/${suffix}`;
}

function flattenPaginated<T>(items: T[] | T[][]): T[] {
  if (items.length > 0 && Array.isArray(items[0]))
    return (items as T[][]).flat();
  return items as T[];
}

async function ghApiPaginatedArray<T>(path: string): Promise<T[]> {
  const pages = await ghJson<T[] | T[][]>([
    "api",
    path,
    "--paginate",
    "--slurp",
  ]);
  return flattenPaginated(pages);
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const REVIEW_MAP: Record<string, string> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  REVIEW_REQUIRED: "required",
};

const REVIEW_STATE_MAP: Record<string, string> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
  PENDING: "pending",
};

const listSchema: FieldDef[] = [
  field("number"),
  field("title"),
  lower("state"),
  pluck("author", "login", "author"),
  boolYesNo("isDraft", "draft"),
  mapEnum("reviewDecision", REVIEW_MAP, "none", "review"),
];

const LIST_JSON_FIELDS = "number,title,state,author,isDraft,reviewDecision";

const PR_LIST_EXTRA_FIELDS: Record<string, ExtraFieldSpec> = {
  body: { jsonKey: "body", def: field("body") },
  createdAt: {
    jsonKey: "createdAt",
    def: relativeTime("createdAt", "created"),
  },
  labels: { jsonKey: "labels", def: joinArray("labels", "name", "labels") },
  milestone: {
    jsonKey: "milestone",
    def: pluck("milestone", "title", "milestone"),
  },
  mergedAt: { jsonKey: "mergedAt", def: relativeTime("mergedAt", "merged_at") },
  updatedAt: {
    jsonKey: "updatedAt",
    def: relativeTime("updatedAt", "updated_at"),
  },
  url: { jsonKey: "url", def: field("url") },
};

const viewSchema: FieldDef[] = [
  field("number"),
  field("title"),
  lower("state"),
  pluck("author", "login", "author"),
  boolYesNo("isDraft", "draft"),
  custom("merged", (item: PrItem) => {
    if ((item.state ?? "").toUpperCase() === "MERGED")
      return item.mergedAt ?? "yes";
    return "no";
  }),
  custom("checks", (item: PrItem) => {
    const checks = item.statusCheckRollup;
    if (!Array.isArray(checks) || checks.length === 0) return NO_CHECKS_SUMMARY;
    return checksSummary(countChecks(checks));
  }),
  custom("body", (item: PrItem) => truncateBody(item.body, 500)),
];

const viewSchemaFull: FieldDef[] = viewSchema.map((f) =>
  "as" in f && f.as === "body"
    ? custom("body", (item: PrItem) =>
        typeof item.body === "string" ? item.body : "",
      )
    : f,
);

const VIEW_JSON_FIELDS =
  "number,title,state,author,isDraft,mergedAt,mergeStateStatus,statusCheckRollup,body,comments,reviews";

// gh pr view --json fields. Keep selection separate from the default view schema
// so opt-in fields retain their original names and nested metadata.
const PR_VIEW_FIELDS = new Set(
  (
    "additions,assignees,author,autoMergeRequest,baseRefName,baseRefOid,body," +
    "changedFiles,closed,closedAt,closingIssuesReferences,comments,commits," +
    "createdAt,deletions,files,fullDatabaseId,headRefName,headRefOid," +
    "headRepository,headRepositoryOwner,id,isCrossRepository,isDraft,labels," +
    "latestReviews,maintainerCanModify,mergeCommit,mergeStateStatus,mergeable," +
    "mergedAt,mergedBy,milestone,number,potentialMergeCommit,projectCards," +
    "projectItems,reactionGroups,reviewDecision,reviewRequests,reviews,state," +
    "statusCheckRollup,title,updatedAt,url"
  ).split(","),
);

/**
 * Hints for `mergeStateStatus` values that need action. CLEAN, HAS_HOOKS and
 * DRAFT read clearly on their own.
 */
function mergeStateHint(
  status: string,
  pr: PrItem,
  ctx?: RepoContext,
): string | undefined {
  const hints: Record<string, string> = {
    DIRTY: "merge conflicts with the base branch",
    BEHIND: `head branch is behind the base branch; gh-axi pr update-branch ${pr.number}${repoTargetFlags(ctx)} brings it up to date`,
    BLOCKED: "blocked by branch protection (e.g. required reviews or checks)",
    UNSTABLE: "mergeable, but some non-required checks are failing",
    UNKNOWN: "GitHub is still computing mergeability; retry shortly",
  };
  return hints[status];
}

/**
 * Place `merge_state` after `checks` for open PRs. GitHub reports UNKNOWN for
 * merged and closed PRs, so they omit the field rather than show a stale value.
 */
function withMergeState(
  schema: FieldDef[],
  pr: PrItem,
  ctx?: RepoContext,
): FieldDef[] {
  if ((pr.state ?? "").toUpperCase() !== "OPEN") return [...schema];
  const mergeStateField = custom("merge_state", (item: PrItem) => {
    const status = (item.mergeStateStatus ?? "UNKNOWN").toUpperCase();
    const hint = mergeStateHint(status, item, ctx);
    const label = status.toLowerCase();
    return hint ? `${label} — ${hint}` : label;
  });
  return schema.flatMap((f) =>
    "as" in f && f.as === "checks" ? [f, mergeStateField] : [f],
  );
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

// --search is intentionally listed: prList rejects it with a dedicated hint
// pointing at `gh-axi search`, so rejectUnknownFlags lets it through to that
// handler instead of shadowing the targeted error.
export const PR_FLAGS: Record<string, readonly string[]> = {
  list: [
    "--fields",
    "--state",
    "--label",
    "--assignee",
    "--author",
    "--base",
    "--head",
    "--draft",
    "--limit",
    "--search",
  ],
  view: ["--comments", "--reviews", "--checks", "--full", "--fields"],
  create: [
    "--title",
    "--body",
    "--body-file",
    "--attach",
    "--base",
    "--head",
    "--draft",
    "--assignee",
    "--reviewer",
    "--label",
    "--milestone",
    "--project",
  ],
  edit: [
    "--title",
    "--body",
    "--body-file",
    "--attach",
    "--add-label",
    "--remove-label",
    "--add-assignee",
    "--remove-assignee",
    "--add-reviewer",
    "--remove-reviewer",
    "--milestone",
    "--base",
  ],
  close: ["--comment"],
  merge: [
    "--method",
    "--merge",
    "--squash",
    "--rebase",
    "--auto",
    "--admin",
    "--delete-branch",
    "--body",
    "--body-file",
    "--subject",
    "--match-head-commit",
  ],
  review: [
    "--approve",
    "--request-changes",
    "--comment",
    "--body",
    "--body-file",
    "--match-head-commit",
  ],
  checks: ["--failed", "--watch", "--interval", "--fail-fast"],
  diff: ["--full", "--patch"],
  checkout: [],
  ready: ["--undo"],
  reopen: [],
  comment: ["--body", "--body-file", "--attach"],
  "update-branch": [],
  revert: [],
};

export const PR_HELP = `usage: gh-axi pr <subcommand> [flags]
subcommands[15]:
  list, view <number>, create, edit <number>, close <number>, merge <number>, review <number>, checks <number>, diff <number>, checkout <number>, ready <number>, reopen <number>, comment <number>, update-branch <number>, revert <number>
flags{list}:
  --state <open|closed|all>, --label (repeatable), --assignee, --author, --base, --head, --draft, --limit <n> (default 30), --fields <a,b,c>
flags{view}:
  --comments, --reviews (show review submissions and inline review comments), --checks (show the detailed check rollup), --full (show complete body without truncation), --fields <a,b,c> (select gh JSON fields as TOON, with complete values; cannot combine with --comments, --reviews, --checks or --full)
fields{view}:
  ${[...PR_VIEW_FIELDS].join(", ")}
flags{create}:
  --title <text> (required), --body <text> or --body-file <path>, --attach <path[#alt]> (repeatable; image/video; requires gh >= 2.99.0), --base, --head, --draft, --assignee <login> (repeatable), --reviewer <login> (repeatable), --label <name> (repeatable), --milestone, --project <name> (repeatable)
flags{edit}:
  --title <text>, --body <text> or --body-file <path>, --attach <path[#alt]> (repeatable; image/video; requires gh >= 2.99.0), --add-label <name> (repeatable), --remove-label <name> (repeatable), --add-assignee <login> (repeatable), --remove-assignee <login> (repeatable), --add-reviewer <login> (repeatable), --remove-reviewer <login> (repeatable), --milestone, --base <branch> (retarget the PR)
flags{close}:
  --comment <text>
flags{merge}:
  --method <merge|squash|rebase>, --merge, --squash, --rebase, --auto, --admin (use administrator privileges to bypass merge requirements; cannot combine with --auto), --delete-branch, --body <text> or --body-file <path>, --subject, --match-head-commit <SHA> (require the PR head to match before merging)
flags{review}:
  --approve, --request-changes, --comment, --body <text> or --body-file <path>, --match-head-commit <SHA> (require the PR head to match before reviewing; the review is recorded on that commit; give exactly one of --approve, --request-changes, --comment)
flags{comment}:
  --body <text> or --body-file <path> (required unless --attach), --attach <path[#alt]> (repeatable; image/video; requires gh >= 2.99.0)
flags{checks}:
  --failed (show only failing checks), --watch (wait until no check is pending), --interval <seconds> (poll interval for --watch, default 10), --fail-fast (with --watch, stop at the first failing check); exits 1 when a check failed or none are reported, 8 when a check is still pending (like gh pr checks)
flags{diff}:
  --full (show complete diff without truncation), --patch (accepted for gh compatibility; output is already patch format)
flags{ready}:
  --undo (convert the PR back to a draft)
examples:
  gh-axi pr list --state open --label bug
  gh-axi pr view 42 --comments
  gh-axi pr view 42 --reviews
  gh-axi pr view 42 --fields number,title,headRefOid,reviews
  gh-axi pr checks 42 --watch --fail-fast
  gh-axi pr create --title "Fix login" --attach './before.png#Before'
  gh-axi pr comment 42 --body-file review.md
  gh-axi pr comment 42 --attach ./after.png
  gh-axi pr merge 42 --squash --delete-branch`;

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

async function prList(args: string[], ctx?: RepoContext): Promise<string> {
  if (args.includes("--search")) {
    throw new AxiError(
      'pr list does not support --search. Use `gh-axi search prs "<query>"` instead for full-text search with total counts.',
      "VALIDATION_ERROR",
    );
  }
  const fieldsArg = takeFlag(args, "--fields");
  const { extraDefs, extraJsonKeys } = parseFields(
    fieldsArg,
    PR_LIST_EXTRA_FIELDS,
  );
  const state = takeFlag(args, "--state") ?? "open";
  const labels = takeAllFlags(args, "--label");
  const assignee = takeRequiredFlag(args, "--assignee");
  const author = takeRequiredFlag(args, "--author");
  const base = takeRequiredFlag(args, "--base");
  const head = takeRequiredFlag(args, "--head");
  const draft = takeBoolFlag(args, "--draft");
  const limit = takeFlag(args, "--limit") ?? "30";

  const jsonFields =
    extraJsonKeys.length > 0
      ? LIST_JSON_FIELDS + "," + extraJsonKeys.join(",")
      : LIST_JSON_FIELDS;
  const ghArgs = [
    "pr",
    "list",
    "--json",
    jsonFields,
    "--state",
    state,
    "--limit",
    limit,
  ];
  pushRepeated(ghArgs, "--label", labels);
  if (assignee) ghArgs.push("--assignee", assignee);
  if (author) ghArgs.push("--author", author);
  if (base) ghArgs.push("--base", base);
  if (head) ghArgs.push("--head", head);
  if (draft) ghArgs.push("--draft");

  const items = await ghJson<PrItem[]>(ghArgs, ctx);
  const isEmpty = items.length === 0;
  const limitNum = Number(limit);

  // Only a page truncated by the limit needs a total; a short page already
  // shows every match.
  let totalCount: number | undefined;
  if (items.length === limitNum && ctx) {
    const filters: ListFilter[] = [];
    for (const label of labels)
      filters.push({ key: "label", value: label, list: true });
    if (assignee) filters.push({ key: "assignee", value: assignee });
    if (author) filters.push({ key: "author", value: author });
    if (base) filters.push({ key: "base", value: base });
    if (head) filters.push({ key: "head", value: head });
    if (draft) filters.push({ key: "draft", value: "true" });

    totalCount = await fetchListTotal(ctx, "pullRequests", state, filters);
  }
  const countLine = formatCountLine({
    count: items.length,
    limit: limitNum,
    totalCount,
  });
  const extendedSchema =
    extraDefs.length > 0 ? [...listSchema, ...extraDefs] : listSchema;

  return renderOutput([
    countLine,
    renderList("pull_requests", items, extendedSchema),
    renderHelp(
      getSuggestions({ domain: "pr", action: "list", isEmpty, repo: ctx }),
    ),
  ]);
}

async function prView(args: string[], ctx?: RepoContext): Promise<string> {
  const fieldsArg = takeSingleRequiredFlag(args, "--fields");
  const includeComments = takeBoolFlag(args, "--comments");
  const includeReviews = takeBoolFlag(args, "--reviews");
  const includeChecks = takeBoolFlag(args, "--checks");
  const full = takeBoolFlag(args, "--full");
  const num = takeNumber(args, "PR");

  if (fieldsArg !== undefined) {
    if (includeComments || includeReviews || includeChecks || full) {
      throw new AxiError(
        "--fields cannot combine with --comments, --reviews, --checks or --full",
        "VALIDATION_ERROR",
      );
    }
    const fields = [
      ...new Set(fieldsArg.split(",").map((name) => name.trim())),
    ];
    if (fields.some((name) => name === "")) {
      throw new AxiError(
        "--fields requires nonblank comma-separated field names",
        "VALIDATION_ERROR",
      );
    }
    const unknown = fields.filter((name) => !PR_VIEW_FIELDS.has(name));
    if (unknown.length > 0) {
      throw new AxiError(
        `Unknown field(s): ${unknown.join(", ")}. Available: ${[...PR_VIEW_FIELDS].join(", ")}`,
        "VALIDATION_ERROR",
      );
    }
    const pr = await ghJson<Record<string, unknown>>(
      ["pr", "view", String(num), "--json", fields.join(",")],
      ctx,
    );
    return encode({ pull_request: pr });
  }

  // Always fetch comments + review summaries (for count or full rendering)
  const ghArgs = ["pr", "view", String(num), "--json", VIEW_JSON_FIELDS];
  const pr = await ghJson<PrItem>(ghArgs, ctx);
  if (Array.isArray(pr.statusCheckRollup)) {
    pr.statusCheckRollup = latestChecks(pr.statusCheckRollup);
  }

  const schema = withMergeState(full ? viewSchemaFull : viewSchema, pr, ctx);
  if (includeComments && Array.isArray(pr.comments)) {
    schema.push(
      custom("comments", (item: PrItem) =>
        (item.comments ?? []).map((c: PrComment) => ({
          author: c.author?.login ?? "unknown",
          body: c.body ?? "",
          created: c.createdAt ?? "",
        })),
      ),
    );
  } else {
    const commentCount = Array.isArray(pr.comments) ? pr.comments.length : 0;
    schema.push(
      custom(
        "comment_count",
        () => `${commentCount} — use --comments to see full comments`,
      ),
    );
  }

  if (includeReviews) {
    // gh pr view --json reviews returns GraphQL node IDs, which don't match
    // the numeric review IDs on inline review comments. Fetch both via REST
    // so we can correlate inline comments back to their parent review.
    const reviews = await ghApiPaginatedArray<PrReview>(
      prRestPath(ctx, num, "reviews"),
    );
    let inlineComments: PrReviewComment[] = [];
    if (reviews.length > 0) {
      inlineComments = await ghApiPaginatedArray<PrReviewComment>(
        prRestPath(ctx, num, "comments"),
      );
    }
    const commentsByReview = new Map<number, PrReviewComment[]>();
    for (const c of inlineComments) {
      if (typeof c.pull_request_review_id === "number") {
        const list = commentsByReview.get(c.pull_request_review_id) ?? [];
        list.push(c);
        commentsByReview.set(c.pull_request_review_id, list);
      }
    }
    schema.push(
      custom("reviews", () =>
        reviews.map((r) => {
          const stateUpper = (r.state ?? "").toUpperCase();
          const inline = commentsByReview.get(r.id) ?? [];
          return {
            author: r.user?.login ?? "unknown",
            state:
              REVIEW_STATE_MAP[stateUpper] ??
              stateUpper.toLowerCase() ??
              "unknown",
            submitted: r.submitted_at ?? "",
            body: r.body ?? "",
            inline_comments: inline.map((c) => ({
              author: c.user?.login ?? "unknown",
              path: c.path ?? "",
              line: c.line ?? c.original_line ?? null,
              body: c.body ?? "",
              created: c.created_at ?? "",
            })),
          };
        }),
      ),
    );
  } else {
    const reviewCount = Array.isArray(pr.reviews) ? pr.reviews.length : 0;
    schema.push(
      custom(
        "review_count",
        () => `${reviewCount} — use --reviews to see full reviews`,
      ),
    );
  }

  const blocks = [renderDetail("pull_request", pr, schema)];
  if (includeChecks) {
    const checks: StatusCheck[] = Array.isArray(pr.statusCheckRollup)
      ? pr.statusCheckRollup
      : [];
    blocks.push(...checksBlocks(checks));
  }

  return renderOutput(blocks);
}

async function prCreate(
  args: string[],
  ctx: RepoContext | undefined,
  attachments: string[],
): Promise<string> {
  const title = takeFlag(args, "--title");
  if (!title) throw new AxiError("--title is required", "VALIDATION_ERROR");
  const body = takeBody(args, ATTACH_BODY_OPTIONS);
  const base = takeFlag(args, "--base");
  const head = takeFlag(args, "--head");
  const draft = takeBoolFlag(args, "--draft");
  const assignees = takeAllFlags(args, "--assignee");
  const reviewers = takeAllFlags(args, "--reviewer");
  const labels = takeAllFlags(args, "--label");
  const milestone = takeFlag(args, "--milestone");
  const projects = takeAllFlags(args, "--project");

  const ghArgs = ["pr", "create", "--title", title];
  if (body !== undefined || attachments.length > 0) {
    ghArgs.push("--body", body ?? "");
  }
  pushAttachments(ghArgs, attachments);
  if (base) ghArgs.push("--base", base);
  if (head) ghArgs.push("--head", head);
  if (draft) ghArgs.push("--draft");
  pushRepeated(ghArgs, "--assignee", assignees);
  pushRepeated(ghArgs, "--reviewer", reviewers);
  pushRepeated(ghArgs, "--label", labels);
  if (milestone) ghArgs.push("--milestone", milestone);
  pushRepeated(ghArgs, "--project", projects);

  let stdout: string;
  let attachmentError: AttachmentMutationError | undefined;
  try {
    stdout =
      attachments.length > 0
        ? await ghExecWithAttachmentState(ghArgs, ctx)
        : await ghExec(ghArgs, ctx);
  } catch (error) {
    if (!(error instanceof AttachmentMutationError)) throw error;
    stdout = error.stdout;
    attachmentError = error;
  }
  // Parse PR number from the emitted URL: https://<host>/OWNER/REPO/pull/123
  const urlMatch = stdout.match(/\/pull\/(\d+)/);
  const num = urlMatch ? Number(urlMatch[1]) : undefined;
  const url = stdout.trim().split("\n").pop()?.trim() ?? "";

  // Report the merge target: omitting --base silently opens against the
  // default branch, so surface the base (and head) the PR was created with.
  let baseRef = base;
  let headRef = head;
  if (num !== undefined && (!baseRef || !headRef)) {
    try {
      const refs = await ghJson<{
        baseRefName?: string;
        headRefName?: string;
      }>(["pr", "view", String(num), "--json", "baseRefName,headRefName"], ctx);
      baseRef = baseRef ?? refs.baseRefName;
      headRef = headRef ?? refs.headRefName;
    } catch {
      // Best effort only - the PR was created, so never fail the command
      // because the follow-up ref lookup did not work.
    }
  }

  const blocks = [
    renderDetail(
      "created",
      { number: num ?? url, url, base: baseRef, head: headRef },
      [field("number"), field("url"), field("base"), field("head")],
    ),
  ];
  if (attachments.length > 0 && num !== undefined) {
    let created: { body?: string };
    try {
      created = await preserveAttachMutation(url, () =>
        ghJson<{ body?: string }>(
          ["pr", "view", String(num), "--json", "body"],
          ctx,
        ),
      );
    } catch (error) {
      if (attachmentError) throw attachmentError.withFollowupError(error);
      throw error;
    }
    if (attachmentError) {
      throw attachmentError.withResults(newAttachmentUrls(created.body, body));
    }
    const attachOut = renderAttachOutput(attachments, created.body, body);
    if (attachOut) blocks.push(attachOut);
  }
  if (attachmentError) throw attachmentError;
  blocks.push(
    renderHelp(
      getSuggestions({ domain: "pr", action: "create", id: num, repo: ctx }),
    ),
  );
  return renderOutput(blocks);
}

async function prEdit(
  args: string[],
  ctx: RepoContext | undefined,
  attachments: string[],
): Promise<string> {
  const num = takeNumber(args, "PR");
  const title = takeFlag(args, "--title");
  const body = takeBody(args, ATTACH_BODY_OPTIONS);
  const addLabels = takeAllFlags(args, "--add-label");
  const removeLabels = takeAllFlags(args, "--remove-label");
  const addAssignees = takeAllFlags(args, "--add-assignee");
  const removeAssignees = takeAllFlags(args, "--remove-assignee");
  const addReviewers = takeAllFlags(args, "--add-reviewer");
  const removeReviewers = takeAllFlags(args, "--remove-reviewer");
  const milestone = takeFlag(args, "--milestone");
  const base = takeFlag(args, "--base");
  let attachmentBaseline = body;
  if (attachments.length > 0 && attachmentBaseline === undefined) {
    const current = await ghJson<{ body?: string }>(
      ["pr", "view", String(num), "--json", "body"],
      ctx,
    );
    attachmentBaseline = current.body;
  }

  const ghArgs = ["pr", "edit", String(num)];
  if (title) ghArgs.push("--title", title);
  if (body !== undefined) ghArgs.push("--body", body);
  pushAttachments(ghArgs, attachments);
  pushRepeated(ghArgs, "--add-label", addLabels);
  pushRepeated(ghArgs, "--remove-label", removeLabels);
  pushRepeated(ghArgs, "--add-assignee", addAssignees);
  pushRepeated(ghArgs, "--remove-assignee", removeAssignees);
  pushRepeated(ghArgs, "--add-reviewer", addReviewers);
  pushRepeated(ghArgs, "--remove-reviewer", removeReviewers);
  if (milestone) ghArgs.push("--milestone", milestone);
  if (base) ghArgs.push("--base", base);

  let attachmentError: AttachmentMutationError | undefined;
  try {
    if (attachments.length > 0) {
      await ghExecWithAttachmentState(ghArgs, ctx);
    } else {
      await ghExec(ghArgs, ctx);
    }
  } catch (error) {
    if (!(error instanceof AttachmentMutationError)) throw error;
    attachmentError = error;
  }
  const blocks = [
    renderDetail("edited", { number: num, status: "ok" }, [
      field("number"),
      field("status"),
    ]),
  ];
  if (attachments.length > 0) {
    let edited: { body?: string };
    try {
      edited = await preserveAttachMutation(`pull request #${num}`, () =>
        ghJson<{ body?: string }>(
          ["pr", "view", String(num), "--json", "body"],
          ctx,
        ),
      );
    } catch (error) {
      if (attachmentError) throw attachmentError.withFollowupError(error);
      throw error;
    }
    if (attachmentError) {
      throw attachmentError.withResults(
        newAttachmentUrls(edited.body, attachmentBaseline),
      );
    }
    const attachOut = renderAttachOutput(
      attachments,
      edited.body,
      attachmentBaseline,
    );
    if (attachOut) blocks.push(attachOut);
  }
  blocks.push(
    renderHelp(
      getSuggestions({ domain: "pr", action: "edit", id: num, repo: ctx }),
    ),
  );
  return renderOutput(blocks);
}

async function prClose(args: string[], ctx?: RepoContext): Promise<string> {
  const comment = takeFlag(args, "--comment");
  const num = takeNumber(args, "PR");

  // Idempotent: check current state
  const pr = await ghJson<Pick<PrItem, "state">>(
    ["pr", "view", String(num), "--json", "state"],
    ctx,
  );
  const state = (pr.state ?? "").toUpperCase();
  if (state === "CLOSED" || state === "MERGED") {
    return renderOutput([
      renderDetail(
        "pull_request",
        { number: num, state: state.toLowerCase(), already: true },
        [field("number"), field("state"), field("already")],
      ),
      renderHelp(
        getSuggestions({ domain: "pr", action: "close", id: num, repo: ctx }),
      ),
    ]);
  }

  const ghArgs = ["pr", "close", String(num)];
  if (comment) ghArgs.push("--comment", comment);
  await ghExec(ghArgs, ctx);

  return renderOutput([
    renderDetail("closed", { number: num, status: "ok" }, [
      field("number"),
      field("status"),
    ]),
    renderHelp(
      getSuggestions({ domain: "pr", action: "close", id: num, repo: ctx }),
    ),
  ]);
}

const MERGE_BOOL_FLAGS = [
  "--merge",
  "--squash",
  "--rebase",
  "--auto",
  "--admin",
  "--delete-branch",
] as const;

/**
 * Reject the `--flag=value` form of a pr merge on/off switch.
 *
 * These flags are matched as whole tokens, so `--admin=true` would otherwise
 * read as absent and be dropped, merging on terms the caller did not ask for.
 * Runs over the raw argv before anything is parsed, because a value-taking
 * option would otherwise swallow the token (`--body --admin=true`) and hide it.
 */
function rejectValuedMergeSwitches(args: string[]): void {
  for (const arg of args) {
    const flag = MERGE_BOOL_FLAGS.find((known) => arg.startsWith(`${known}=`));
    if (!flag) continue;
    throw new AxiError(
      `${arg} is not supported: ${flag} is an on/off flag, so pass ${flag} on its own to turn it on, or omit it to leave it off`,
      "VALIDATION_ERROR",
    );
  }
}

async function prMerge(args: string[], ctx?: RepoContext): Promise<string> {
  rejectValuedMergeSwitches(args);
  // Extract before positional/body/subject parsing can swallow the condition.
  // Pass the value unchanged to gh, which enforces the head match.
  const matchHeadCommit = takeSingleRequiredFlag(args, "--match-head-commit");
  const num = takeNumber(args, "PR");
  const explicitMethod = takeFlag(args, "--method");
  const shorthandMethods = ["merge", "squash", "rebase"].filter((candidate) =>
    takeBoolFlag(args, `--${candidate}`),
  );
  if (shorthandMethods.length > 1) {
    throw new AxiError(
      "Choose only one merge method: --merge, --squash, or --rebase",
      "VALIDATION_ERROR",
    );
  }
  if (
    explicitMethod &&
    shorthandMethods.length === 1 &&
    explicitMethod !== shorthandMethods[0]
  ) {
    throw new AxiError(
      "Choose either --method or a matching merge method shorthand, not both",
      "VALIDATION_ERROR",
    );
  }
  const method = explicitMethod ?? shorthandMethods[0];
  if (method && !["merge", "squash", "rebase"].includes(method)) {
    throw new AxiError(
      "--method must be one of: merge, squash, rebase",
      "VALIDATION_ERROR",
    );
  }
  const auto = takeBoolFlag(args, "--auto");
  const admin = takeBoolFlag(args, "--admin");
  if (auto && admin) {
    throw new AxiError(
      "Choose either --auto or --admin, not both: --auto waits for merge requirements, --admin bypasses them",
      "VALIDATION_ERROR",
    );
  }
  const deleteBranch = takeBoolFlag(args, "--delete-branch");
  const body = takeBody(args);
  const subject = takeFlag(args, "--subject");

  // Idempotent: check if already merged
  const pr = await ghJson<
    Pick<PrItem, "state" | "mergedBy" | "mergedAt"> & { id: string }
  >(["pr", "view", String(num), "--json", "state,mergedBy,mergedAt,id"], ctx);
  if ((pr.state ?? "").toUpperCase() === "MERGED") {
    return renderOutput([
      renderDetail(
        "pull_request",
        {
          number: num,
          state: "merged",
          merged_by: pr.mergedBy?.login ?? null,
          merged_at: pr.mergedAt ?? null,
        },
        [
          field("number"),
          field("state"),
          field("merged_by"),
          field("merged_at"),
        ],
      ),
      renderHelp(
        getSuggestions({ domain: "pr", action: "merge", id: num, repo: ctx }),
      ),
    ]);
  }

  const ghArgs = ["pr", "merge", String(num)];
  if (method) ghArgs.push("--" + method);
  if (auto) ghArgs.push("--auto");
  if (admin) ghArgs.push("--admin");
  if (deleteBranch) ghArgs.push("--delete-branch");
  if (body !== undefined) ghArgs.push("--body", body);
  if (subject) ghArgs.push("--subject", subject);
  if (matchHeadCommit) ghArgs.push("--match-head-commit", matchHeadCommit);

  await ghExec(ghArgs, ctx);
  const status = await mergeOutcome(num, pr.id, ctx);

  return renderOutput([
    renderDetail(
      "merge",
      { number: num, status, method: method ?? "default", admin },
      [field("number"), field("status"), field("method"), boolYesNo("admin")],
    ),
    renderHelp(
      getSuggestions({
        domain: "pr",
        action: "merge",
        state: status,
        id: num,
        repo: ctx,
      }),
    ),
  ]);
}

const MERGE_OUTCOME_QUERY =
  "query($id:ID!){node(id:$id){... on PullRequest{state isInMergeQueue autoMergeRequest{enabledAt}}}}";

/**
 * What `gh pr merge` actually did. It exits 0 whether it merged the PR, added
 * it to a merge queue, or only enabled auto-merge, so re-read the PR. `pr view
 * --json` has no merge-queue field, hence GraphQL by node ID. `gh api` rejects
 * `--repo`, so `ctx` only feeds the suggestions.
 */
async function mergeOutcome(
  num: number,
  id: string,
  ctx?: RepoContext,
): Promise<"merged" | "enqueued" | "auto-merge"> {
  let after:
    | { state?: string; isInMergeQueue?: boolean; autoMergeRequest?: unknown }
    | undefined;
  try {
    const result = await ghJson<{ data?: { node?: typeof after } }>([
      "api",
      "graphql",
      "-f",
      `id=${id}`,
      "-f",
      `query=${MERGE_OUTCOME_QUERY}`,
    ]);
    after = result.data?.node;
  } catch (error) {
    throw MutationFollowupError.from(`PR #${num}`, error);
  }
  const state = (after?.state ?? "unknown").toLowerCase();
  if (state === "merged") return "merged";
  if (after?.isInMergeQueue) return "enqueued";
  if (after?.autoMergeRequest) return "auto-merge";
  throw new AxiError(
    `gh pr merge exited 0, but PR #${num} is ${state}: not merged, not in a merge queue, and auto-merge is not enabled`,
    "UNKNOWN",
    getSuggestions({
      domain: "pr",
      action: "merge",
      state,
      id: num,
      repo: ctx,
    }),
  );
}

async function prReview(args: string[], ctx?: RepoContext): Promise<string> {
  const matchHeadCommit = takeSingleRequiredFlag(args, "--match-head-commit");
  const num = takeNumber(args, "PR");
  const approve = takeBoolFlag(args, "--approve");
  const requestChanges = takeBoolFlag(args, "--request-changes");
  const commentFlag = takeBoolFlag(args, "--comment");
  const body = takeBody(args);

  if (matchHeadCommit) {
    await submitReviewOnHead(
      num,
      matchHeadCommit,
      { approve, requestChanges, comment: commentFlag },
      body,
      ctx,
    );
  } else {
    const ghArgs = ["pr", "review", String(num)];
    if (approve) ghArgs.push("--approve");
    else if (requestChanges) ghArgs.push("--request-changes");
    else if (commentFlag) ghArgs.push("--comment");
    if (body !== undefined) ghArgs.push("--body", body);

    await ghExec(ghArgs, ctx);
  }

  const action = approve
    ? "approved"
    : requestChanges
      ? "changes_requested"
      : "commented";
  return renderOutput([
    renderDetail("review", { number: num, action }, [
      field("number"),
      field("action"),
    ]),
    renderHelp(
      getSuggestions({ domain: "pr", action: "review", id: num, repo: ctx }),
    ),
  ]);
}

async function submitReviewOnHead(
  num: number,
  expectedHead: string,
  chosen: { approve: boolean; requestChanges: boolean; comment: boolean },
  body: string | undefined,
  ctx?: RepoContext,
): Promise<void> {
  const picked = [chosen.approve, chosen.requestChanges, chosen.comment];
  if (picked.filter(Boolean).length !== 1) {
    throw new AxiError(
      "--match-head-commit needs exactly one of --approve, --request-changes, --comment",
      "VALIDATION_ERROR",
    );
  }
  const event = chosen.approve
    ? "APPROVE"
    : chosen.requestChanges
      ? "REQUEST_CHANGES"
      : "COMMENT";

  const pr = await ghJson<{ headRefOid: string }>(
    ["pr", "view", String(num), "--json", "headRefOid"],
    ctx,
  );
  if (pr.headRefOid.toLowerCase() !== expectedHead.toLowerCase()) {
    throw new AxiError(
      `PR #${num} head is ${pr.headRefOid}, not ${expectedHead}; no review was sent`,
      "VALIDATION_ERROR",
    );
  }

  const ghArgs = [
    "api",
    prRestPath(ctx, num, "reviews"),
    "--method",
    "POST",
    "--raw-field",
    `event=${event}`,
    "--raw-field",
    `commit_id=${pr.headRefOid}`,
  ];
  if (body !== undefined) ghArgs.push("--raw-field", `body=${body}`);
  await ghExec(ghArgs);
}

// Summary line plus per-check rows, shared by `pr checks` and `pr view --checks`.
// Counts always describe the full rollup so a filtered list keeps its context.
function checksBlocks(checks: StatusCheck[], onlyFailed = false): string[] {
  if (checks.length === 0) {
    return [encode({ checks: NO_CHECKS_SUMMARY })];
  }

  const checksSchema: FieldDef[] = [
    custom("name", (c: StatusCheck) => c.name ?? c.context ?? "check"),
    custom("conclusion", (c: StatusCheck) => classifyCheck(c)),
  ];

  const visible = onlyFailed
    ? checks.filter((c: StatusCheck) => classifyCheck(c) === "fail")
    : checks;

  return [
    encode({ summary: checksSummary(countChecks(checks)) }),
    renderList("checks", visible, checksSchema),
  ];
}

// Exit codes match `gh pr checks`: 1 when a check failed (or none were
// reported), 8 when a check is still pending, 0 otherwise.
export const CHECKS_EXIT_FAILED = 1;
export const CHECKS_EXIT_PENDING = 8;
const DEFAULT_WATCH_INTERVAL_SECONDS = 10;
// Node clamps a setTimeout delay above 2147483647 ms to 1 ms, which would turn
// a long --interval into a tight polling loop.
const MAX_WATCH_INTERVAL_SECONDS = 2147483;

function checksExitCode(checks: StatusCheck[]): number {
  if (checks.length === 0) return CHECKS_EXIT_FAILED;
  const counts = countChecks(checks);
  if (counts.failed > 0) return CHECKS_EXIT_FAILED;
  if (counts.pending > 0) return CHECKS_EXIT_PENDING;
  return 0;
}

function takeWatchInterval(args: string[]): number | undefined {
  const raw = takeRequiredFlag(args, "--interval");
  if (raw === undefined) return undefined;
  if (
    !/^\d+$/.test(raw) ||
    Number(raw) < 1 ||
    Number(raw) > MAX_WATCH_INTERVAL_SECONDS
  ) {
    throw new AxiError(
      `--interval must be a whole number of seconds from 1 to ${MAX_WATCH_INTERVAL_SECONDS}, got "${raw}"`,
      "VALIDATION_ERROR",
    );
  }
  return Number(raw);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchChecks(
  num: number,
  ctx?: RepoContext,
): Promise<StatusCheck[]> {
  // Use pr view --json statusCheckRollup instead of pr checks --json which
  // can error on PRs with unusual check data
  const pr = await ghJson<Pick<PrItem, "statusCheckRollup">>(
    ["pr", "view", String(num), "--json", "statusCheckRollup"],
    ctx,
  );
  return Array.isArray(pr.statusCheckRollup)
    ? latestChecks(pr.statusCheckRollup)
    : [];
}

async function prChecks(args: string[], ctx?: RepoContext): Promise<string> {
  // Take --interval first: its value must not be read as the PR number, and a
  // following flag (`--interval --watch`) is a missing value, not a value.
  const interval = takeWatchInterval(args);
  const onlyFailed = takeBoolFlag(args, "--failed");
  const watch = takeBoolFlag(args, "--watch");
  const failFast = takeBoolFlag(args, "--fail-fast");
  if (failFast && !watch) {
    throw new AxiError("--fail-fast requires --watch", "VALIDATION_ERROR");
  }
  if (interval !== undefined && !watch) {
    throw new AxiError("--interval requires --watch", "VALIDATION_ERROR");
  }
  const num = takeNumber(args, "PR");
  const intervalMs = (interval ?? DEFAULT_WATCH_INTERVAL_SECONDS) * 1000;

  let checks = await fetchChecks(num, ctx);
  // Like gh, watch mode stops as soon as nothing is pending. An empty rollup
  // ends the watch too: gh reports it as an error instead of waiting.
  while (watch && checks.length > 0) {
    const counts = countChecks(checks);
    if (counts.pending === 0) break;
    if (failFast && counts.failed > 0) break;
    await sleep(intervalMs);
    checks = await fetchChecks(num, ctx);
  }

  const exitCode = checksExitCode(checks);
  if (exitCode !== 0) process.exitCode = exitCode;

  const state =
    checks.length === 0
      ? "empty"
      : exitCode === CHECKS_EXIT_PENDING
        ? "pending"
        : undefined;
  return renderOutput([
    ...checksBlocks(checks, onlyFailed),
    renderHelp(
      getSuggestions({
        domain: "pr",
        action: "checks",
        id: num,
        repo: ctx,
        ...(state ? { state } : {}),
      }),
    ),
  ]);
}

const DIFF_TRUNCATE_LIMIT = 4000;

async function prDiff(args: string[], ctx?: RepoContext): Promise<string> {
  // Accepted for gh compatibility: gh-axi's diff output is already patch format
  takeBoolFlag(args, "--patch");
  const full = takeBoolFlag(args, "--full");
  const num = takeNumber(args, "PR");
  const diff = await ghExec(["pr", "diff", String(num)], ctx);

  const shouldTruncate = !full && diff.length > DIFF_TRUNCATE_LIMIT;
  const prDiffBlock: Record<string, unknown> = {
    number: num,
    diff: shouldTruncate ? diff.slice(0, DIFF_TRUNCATE_LIMIT) : diff,
  };
  if (shouldTruncate) {
    prDiffBlock.truncated = true;
    prDiffBlock.original_length = diff.length;
  }

  const suggestions = getSuggestions({
    domain: "pr",
    action: "diff",
    id: num,
    repo: ctx,
  });
  if (shouldTruncate) {
    // Flags go after the command in AXI output (see normalizeRepoFlagLine);
    // this line is unshifted after suggestion normalization, so emit it
    // already normalized.
    const repoArg = ctx && ctx.source !== "git" ? ` -R ${ctx.nwo}` : "";
    suggestions.unshift(
      `Run \`gh-axi pr diff ${num} --full${repoArg}\` to see the complete diff`,
    );
  }

  return renderOutput([
    encode({ pr_diff: prDiffBlock }),
    renderHelp(suggestions),
  ]);
}

async function prCheckout(args: string[], ctx?: RepoContext): Promise<string> {
  const num = takeNumber(args, "PR");
  const stdout = await ghExec(["pr", "checkout", String(num)], ctx);
  // Extract branch name from output
  const branchMatch = stdout.match(/Switched to branch '([^']+)'/);
  const branch = branchMatch ? branchMatch[1] : stdout.trim();

  return renderOutput([
    renderDetail("checkout", { number: num, branch, status: "ok" }, [
      field("number"),
      field("branch"),
      field("status"),
    ]),
    renderHelp(
      getSuggestions({ domain: "pr", action: "checkout", id: num, repo: ctx }),
    ),
  ]);
}

async function prReady(args: string[], ctx?: RepoContext): Promise<string> {
  const num = takeNumber(args, "PR");
  const undo = takeBoolFlag(args, "--undo");
  const suggestions = () =>
    renderHelp(
      getSuggestions({
        domain: "pr",
        action: "ready",
        id: num,
        repo: ctx,
        ...(undo ? { state: "draft" } : {}),
      }),
    );

  // Idempotent: check if already in the requested state (not a draft for a
  // plain ready, a draft for --undo)
  const pr = await ghJson<Pick<PrItem, "isDraft">>(
    ["pr", "view", String(num), "--json", "isDraft"],
    ctx,
  );
  if (undo ? pr.isDraft : !pr.isDraft) {
    return renderOutput([
      renderDetail(
        "pull_request",
        { number: num, draft: undo ? "yes" : "no", already: true },
        [field("number"), field("draft"), field("already")],
      ),
      suggestions(),
    ]);
  }

  if (undo) {
    await ghExec(["pr", "ready", String(num), "--undo"], ctx);
    return renderOutput([
      renderDetail(
        "pull_request",
        { number: num, draft: "yes", status: "ok" },
        [field("number"), field("draft"), field("status")],
      ),
      suggestions(),
    ]);
  }

  await ghExec(["pr", "ready", String(num)], ctx);
  return renderOutput([
    renderDetail("ready", { number: num, status: "ok" }, [
      field("number"),
      field("status"),
    ]),
    suggestions(),
  ]);
}

async function prReopen(args: string[], ctx?: RepoContext): Promise<string> {
  const num = takeNumber(args, "PR");

  // Idempotent: check current state
  const pr = await ghJson<Pick<PrItem, "state">>(
    ["pr", "view", String(num), "--json", "state"],
    ctx,
  );
  const state = (pr.state ?? "").toUpperCase();
  if (state === "OPEN") {
    return renderOutput([
      renderDetail(
        "pull_request",
        { number: num, state: "open", already: true },
        [field("number"), field("state"), field("already")],
      ),
      renderHelp(
        getSuggestions({ domain: "pr", action: "reopen", id: num, repo: ctx }),
      ),
    ]);
  }

  await ghExec(["pr", "reopen", String(num)], ctx);
  return renderOutput([
    renderDetail("reopened", { number: num, status: "ok" }, [
      field("number"),
      field("status"),
    ]),
    renderHelp(
      getSuggestions({ domain: "pr", action: "reopen", id: num, repo: ctx }),
    ),
  ]);
}

async function prComment(
  args: string[],
  ctx: RepoContext | undefined,
  attachments: string[],
): Promise<string> {
  const num = takeNumber(args, "PR");
  const body = takeBody(args, attachBodyOptions(attachments.length === 0));

  const ghArgs = ["pr", "comment", String(num)];
  if (body !== undefined) ghArgs.push("--body", body);
  pushAttachments(ghArgs, attachments);
  let commentOutput: string;
  let attachmentError: AttachmentMutationError | undefined;
  try {
    commentOutput =
      attachments.length > 0
        ? await ghExecWithAttachmentState(ghArgs, ctx)
        : await ghExec(ghArgs, ctx);
  } catch (error) {
    if (!(error instanceof AttachmentMutationError)) throw error;
    commentOutput = error.stdout;
    attachmentError = error;
  }

  const blocks = [
    renderDetail("commented", { number: num, status: "ok" }, [
      field("number"),
      field("status"),
    ]),
  ];
  if (attachments.length > 0) {
    let createdComment: Awaited<ReturnType<typeof fetchCreatedComment>>;
    try {
      createdComment = await fetchCreatedComment(commentOutput, ctx);
    } catch (error) {
      if (attachmentError) throw attachmentError.withFollowupError(error);
      throw error;
    }
    if (attachmentError) {
      throw attachmentError.withResults(
        newAttachmentUrls(createdComment.body, body),
      );
    }
    const attachOut = renderAttachOutput(
      attachments,
      createdComment.body,
      body,
    );
    if (attachOut) blocks.push(attachOut);
  }
  blocks.push(
    renderHelp(
      getSuggestions({ domain: "pr", action: "comment", id: num, repo: ctx }),
    ),
  );
  return renderOutput(blocks);
}

async function prUpdateBranch(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const num = takeNumber(args, "PR");
  await ghExec(["pr", "update-branch", String(num)], ctx);
  return renderOutput([
    renderDetail("updated", { number: num, status: "ok" }, [
      field("number"),
      field("status"),
    ]),
    renderHelp(
      getSuggestions({
        domain: "pr",
        action: "update-branch",
        id: num,
        repo: ctx,
      }),
    ),
  ]);
}

async function prRevert(args: string[], ctx?: RepoContext): Promise<string> {
  const num = takeNumber(args, "PR");

  // gh pr revert may not exist in all gh versions; fall back to API
  const result = await ghRaw(["pr", "revert", String(num)], ctx);
  if (result.exitCode === 0) {
    // Try to extract the new PR number/URL from stdout
    const urlMatch = result.stdout.match(/\/pull\/(\d+)/);
    const newNum = urlMatch ? Number(urlMatch[1]) : null;
    return renderOutput([
      renderDetail(
        "reverted",
        { number: num, revert_pr: newNum, status: "ok" },
        [field("number"), field("revert_pr"), field("status")],
      ),
      renderHelp(
        getSuggestions({
          domain: "pr",
          action: "revert",
          id: newNum ?? num,
          repo: ctx,
        }),
      ),
    ]);
  }

  // Fallback: use gh api to create a revert via the REST API
  const apiResult = await ghRaw(
    ["api", `repos/{owner}/{repo}/pulls/${num}/revert`, "--method", "POST"],
    ctx,
  );
  if (apiResult.exitCode !== 0) {
    throw new AxiError(
      apiResult.stderr.trim().split("\n")[0] || `Failed to revert PR #${num}`,
      "UNKNOWN",
    );
  }
  let revertData: RevertResult;
  try {
    revertData = JSON.parse(apiResult.stdout) as RevertResult;
  } catch {
    revertData = {};
  }

  return renderOutput([
    renderDetail(
      "reverted",
      {
        number: num,
        revert_pr: revertData.number ?? null,
        url: revertData.html_url ?? null,
        status: "ok",
      },
      [field("number"), field("revert_pr"), field("url"), field("status")],
    ),
    renderHelp(
      getSuggestions({
        domain: "pr",
        action: "revert",
        id: revertData.number ?? num,
        repo: ctx,
      }),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function prCommand(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const sub = args[0];
  const rest = args.slice(1);

  let attachments: string[] = [];
  if (
    (sub === "create" || sub === "edit" || sub === "comment") &&
    hasAttachmentFlag(rest)
  ) {
    await ensureAttachmentSupport();
    attachments = collectAttachments(rest, "take");
  }

  switch (sub) {
    case "list":
      rejectUnknownFlags(rest, PR_FLAGS.list, "pr", "list");
      return prList(rest, ctx);
    case "view":
      rejectUnknownFlags(rest, PR_FLAGS.view, "pr", "view");
      return prView(rest, ctx);
    case "create":
      rejectUnknownFlags(rest, PR_FLAGS.create, "pr", "create");
      return prCreate(rest, ctx, attachments);
    case "edit":
      rejectUnknownFlags(rest, PR_FLAGS.edit, "pr", "edit");
      return prEdit(rest, ctx, attachments);
    case "close":
      rejectUnknownFlags(rest, PR_FLAGS.close, "pr", "close");
      return prClose(rest, ctx);
    case "merge":
      rejectUnknownFlags(rest, PR_FLAGS.merge, "pr", "merge");
      return prMerge(rest, ctx);
    case "review":
      rejectUnknownFlags(rest, PR_FLAGS.review, "pr", "review");
      return prReview(rest, ctx);
    case "checks":
      rejectUnknownFlags(rest, PR_FLAGS.checks, "pr", "checks");
      return prChecks(rest, ctx);
    case "diff":
      rejectUnknownFlags(rest, PR_FLAGS.diff, "pr", "diff");
      return prDiff(rest, ctx);
    case "checkout":
      rejectUnknownFlags(rest, PR_FLAGS.checkout, "pr", "checkout");
      return prCheckout(rest, ctx);
    case "ready":
      rejectUnknownFlags(rest, PR_FLAGS.ready, "pr", "ready");
      return prReady(rest, ctx);
    case "reopen":
      rejectUnknownFlags(rest, PR_FLAGS.reopen, "pr", "reopen");
      return prReopen(rest, ctx);
    case "comment":
      rejectUnknownFlags(rest, PR_FLAGS.comment, "pr", "comment");
      return prComment(rest, ctx, attachments);
    case "update-branch":
      rejectUnknownFlags(
        rest,
        PR_FLAGS["update-branch"],
        "pr",
        "update-branch",
      );
      return prUpdateBranch(rest, ctx);
    case "revert":
      rejectUnknownFlags(rest, PR_FLAGS.revert, "pr", "revert");
      return prRevert(rest, ctx);
    case "--help":
    case "-h":
    case "help":
    case undefined:
      return PR_HELP;
    default:
      return renderError(`Unknown pr subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Run `gh-axi pr --help` to see available subcommands",
      ]);
  }
}
