import type { ProjectContext } from "../context.js";
import { glabJson, glabExec } from "../glab.js";
import { AxiError, MutationFollowupError } from "../errors.js";
import { getSuggestions } from "../suggestions.js";
import {
  getFlag,
  getAllFlags,
  pushRepeated,
  getPositional,
  requireNumber,
  takeFlag,
  takeBoolFlag,
  takeNumber,
  takeAllFlags,
  takeRequiredFlag,
  rejectUnknownFlags,
} from "../args.js";
import { takeDescription, truncateBody } from "../body.js";
import { formatCountLine } from "../format.js";
import {
  field,
  pluck,
  joinStrings,
  relativeTime,
  lower,
  boolYesNo,
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

interface MrListItem {
  [key: string]: unknown;
  iid: number;
  title: string;
  state: string;
  author?: { username?: string };
  created_at?: string;
  description?: string;
  draft?: boolean;
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

export const MR_HELP = `usage: glab-axi mr <subcommand> [flags]
subcommands[6]:
  list, view <number>, create, merge <number>, close <number>, reopen <number>
flags{list}:
  --state <opened|closed|merged|all>, --label <name> (repeatable), --assignee <username> (repeatable), --author <username>, --source-branch <name>, --target-branch <name>, --limit <n> (default 30), --fields <a,b,c>
flags{view}:
  --full (show the complete description without truncation)
flags{create}:
  --title <text> (required), --description <text> or --description-file <path>, --source-branch <name>, --target-branch <name>, --assignee <username> (repeatable), --label <name> (repeatable), --milestone <id>
flags{merge}:
  --squash, --rebase (choose at most one; the project's configured merge method applies when neither is given), --auto (wait for pipeline instead of merging immediately), --remove-source-branch, --message <text>, --sha <sha>
flags{close}:
  (none)
flags{reopen}:
  (none)
examples:
  glab-axi mr list --state opened --label bug
  glab-axi mr view 42
  glab-axi mr view 42 -R group/subgroup/project
  glab-axi mr create --title "Fix login" --description-file notes.md --source-branch fix-login
  glab-axi mr merge 42 --squash
  glab-axi mr merge 42 --auto
  glab-axi mr close 42`;

// ---------------------------------------------------------------------------
// Per-subcommand known flags (for rejectUnknownFlags)
// ---------------------------------------------------------------------------

export const MR_FLAGS: Record<string, readonly string[]> = {
  list: [
    "--fields",
    "--state",
    "--label",
    "--assignee",
    "--author",
    "--source-branch",
    "--target-branch",
    "--limit",
  ],
  view: ["--full"],
  create: [
    "--title",
    "--description",
    "--description-file",
    "--source-branch",
    "--target-branch",
    "--assignee",
    "--label",
    "--milestone",
  ],
  merge: [
    "--squash",
    "--rebase",
    "--auto",
    "--remove-source-branch",
    "--message",
    "--sha",
  ],
  close: [],
  reopen: [],
};

// ---------------------------------------------------------------------------
// Field schemas
// ---------------------------------------------------------------------------

const listSchema: FieldDef[] = [
  field("iid"),
  field("title"),
  lower("state"),
  pluck("author", "username", "author"),
  relativeTime("created_at", "created"),
  boolYesNo("draft", "draft"),
];

const MR_LIST_EXTRA_FIELDS: Record<string, { jsonKey: string; def: FieldDef }> = {
  description: { jsonKey: "description", def: field("description") },
  labels: { jsonKey: "labels", def: joinStrings("labels") },
  sourceBranch: { jsonKey: "source_branch", def: field("source_branch") },
  targetBranch: { jsonKey: "target_branch", def: field("target_branch") },
  url: { jsonKey: "web_url", def: field("web_url", "url") },
  updatedAt: {
    jsonKey: "updated_at",
    def: relativeTime("updated_at", "updated"),
  },
};

const viewSchema: FieldDef[] = [
  field("iid"),
  field("title"),
  lower("state"),
  pluck("author", "username", "author"),
  relativeTime("created_at", "created"),
  boolYesNo("draft", "draft"),
  field("source_branch"),
  field("target_branch"),
  custom("merged", (item: Record<string, unknown>) =>
    exactState(item) === "merged" ? (item.merged_at ?? "yes") : "no",
  ),
  custom("description", (item: Record<string, unknown>) =>
    truncateBody(item.description, 500),
  ),
  joinStrings("labels"),
  field("web_url", "url"),
];

const viewSchemaFull: FieldDef[] = viewSchema.map((f) =>
  "as" in f && f.as === "description"
    ? custom("description", (item: Record<string, unknown>) =>
        typeof item.description === "string" ? item.description : "",
      )
    : f,
);

const createResultSchema: FieldDef[] = [
  field("iid"),
  field("title"),
  lower("state"),
  field("web_url", "url"),
];

const stateResultSchema: FieldDef[] = [field("iid"), lower("state")];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Exact state value from glab JSON, or undefined when absent or of an
 * unexpected shape. State matching accepts exact values only (e.g. exactly
 * `merged`), never a substring, so an output-format change degrades to
 * silence, not a false positive.
 */
function exactState(item: unknown): string | undefined {
  const state = (item as { state?: unknown } | null | undefined)?.state;
  return typeof state === "string" && state.trim() !== ""
    ? state.trim().toLowerCase()
    : undefined;
}

/** Translate a `--state` filter into glab mr list flags (opened is the default). */
function pushStateFilter(glabArgs: string[], state: string | undefined): void {
  if (!state) return;
  switch (state) {
    case "opened":
      // glab mr list defaults to opened; no flag needed.
      break;
    case "closed":
      glabArgs.push("--closed");
      break;
    case "merged":
      glabArgs.push("--merged");
      break;
    case "all":
      glabArgs.push("--all");
      break;
    default:
      throw new AxiError(
        `Invalid --state value: ${state}. Must be one of: opened, closed, merged, all`,
        "VALIDATION_ERROR",
      );
  }
}

/**
 * Resolve --fields extra columns. glab has no field selector — the JSON comes
 * back complete — so extras only extend the output schema.
 */
function collectExtraFields(
  fieldsArg: string | undefined,
  extras: Record<string, { jsonKey: string; def: FieldDef }>,
): FieldDef[] {
  if (!fieldsArg) return [];
  const extraDefs: FieldDef[] = [];
  for (const raw of fieldsArg.split(",")) {
    const name = raw.trim();
    if (name === "") continue;
    const spec = extras[name];
    if (!spec) {
      throw new AxiError(
        `Unknown --fields entry: ${name}. Available: ${Object.keys(extras).join(", ")}`,
        "VALIDATION_ERROR",
      );
    }
    extraDefs.push(spec.def);
  }
  return extraDefs;
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

async function listMrs(args: string[], ctx?: ProjectContext): Promise<string> {
  const state = getFlag(args, "--state");
  // Validate the state even before fetching so a typo fails fast.
  pushStateFilter([], state);
  const labels = getAllFlags(args, "--label");
  const assignees = getAllFlags(args, "--assignee");
  const author = getFlag(args, "--author");
  const sourceBranch = getFlag(args, "--source-branch");
  const targetBranch = getFlag(args, "--target-branch");
  const limitRaw = getFlag(args, "--limit");
  const limit = limitRaw ? parseInt(limitRaw, 10) : 30;
  const extraDefs = collectExtraFields(getFlag(args, "--fields"), MR_LIST_EXTRA_FIELDS);

  const glabArgs = ["mr", "list", "-F", "json", "--per-page", String(limit)];
  pushStateFilter(glabArgs, state);
  pushRepeated(glabArgs, "--label", labels);
  pushRepeated(glabArgs, "--assignee", assignees);
  if (author) glabArgs.push("--author", author);
  if (sourceBranch) glabArgs.push("--source-branch", sourceBranch);
  if (targetBranch) glabArgs.push("--target-branch", targetBranch);

  const items = await glabJson<MrListItem[]>(glabArgs, ctx);
  const isEmpty = items.length === 0;
  const countLine = formatCountLine({ count: items.length, limit });

  const extendedSchema =
    extraDefs.length > 0 ? [...listSchema, ...extraDefs] : listSchema;
  const blocks: string[] = [
    countLine,
    renderList("mrs", items, extendedSchema),
  ];
  const help = getSuggestions({
    domain: "mr",
    action: "list",
    isEmpty,
    repo: ctx,
  });
  blocks.push(renderHelp(help));

  return renderOutput(blocks);
}

async function viewMr(args: string[], ctx?: ProjectContext): Promise<string> {
  const num = requireNumber(getPositional(args, 1), "merge request");
  const full = takeBoolFlag(args, "--full");

  const item = await glabJson<Record<string, unknown>>(
    ["mr", "view", String(num), "-F", "json"],
    ctx,
  );
  const schema = full ? viewSchemaFull : viewSchema;
  return renderOutput([
    renderDetail("mr", item, schema),
    renderHelp(
      getSuggestions({
        domain: "mr",
        action: "view",
        state: exactState(item),
        id: num,
        repo: ctx,
      }),
    ),
  ]);
}

async function createMr(args: string[], ctx?: ProjectContext): Promise<string> {
  const title = takeRequiredFlag(args, "--title");
  if (!title) throw new AxiError("--title is required", "VALIDATION_ERROR");

  // Resolve the description ourselves (inline or file) so the child glab
  // always receives a concrete value and never opens an interactive editor.
  const description = takeDescription(args) ?? "";
  const sourceBranch = takeFlag(args, "--source-branch");
  const targetBranch = takeFlag(args, "--target-branch");
  const assignees = takeAllFlags(args, "--assignee");
  const labels = takeAllFlags(args, "--label");
  const milestone = takeFlag(args, "--milestone");

  const glabArgs = [
    "mr",
    "create",
    "--title",
    title,
    "--description",
    description,
    "--yes",
  ];
  if (sourceBranch) glabArgs.push("--source-branch", sourceBranch);
  if (targetBranch) glabArgs.push("--target-branch", targetBranch);
  pushRepeated(glabArgs, "--assignee", assignees);
  pushRepeated(glabArgs, "--label", labels);
  if (milestone) glabArgs.push("--milestone", milestone);

  const output = await glabExec(glabArgs, ctx);
  const urlMatch =
    output.match(/https?:\/\/\S+\/-\/merge_requests\/(\d+)\S*/g)?.[0] ??
    output.match(/https?:\/\/\S+/)?.[0] ??
    output.trim();
  const numMatch = urlMatch.match(/\/-\/merge_requests\/(\d+)/);
  const num = numMatch ? parseInt(numMatch[1], 10) : 0;

  // Fetch the created MR for structured output. A failure here must not
  // suggest retrying the creation.
  let item: Record<string, unknown>;
  try {
    item = await glabJson<Record<string, unknown>>(
      ["mr", "view", String(num), "-F", "json"],
      ctx,
    );
  } catch (error) {
    throw MutationFollowupError.from(urlMatch, error);
  }

  const blocks: string[] = [renderDetail("mr", item, createResultSchema)];
  const help = getSuggestions({
    domain: "mr",
    action: "create",
    id: typeof item.iid === "number" ? item.iid : num,
    repo: ctx,
  });
  blocks.push(renderHelp(help));

  return renderOutput(blocks);
}

/**
 * gh rejects some flag combinations at parse time and glab-axi mirrors the
 * same shape of guard locally: takeBoolFlag matches whole tokens only, while
 * rejectUnknownFlags compares the flag name with any `=value` stripped, so a
 * known boolean written as `--squash=false` would clear both guards and then
 * be dropped without a word. Reject valued switches up front instead.
 */
function rejectValuedMergeSwitches(args: string[]): void {
  const switches = [
    "--squash",
    "--rebase",
    "--auto",
    "--remove-source-branch",
  ];
  for (const arg of args) {
    for (const flag of switches) {
      if (arg.startsWith(`${flag}=`)) {
        throw new AxiError(
          `${arg}: use ${flag} alone (boolean flags do not take a value)`,
          "VALIDATION_ERROR",
        );
      }
    }
  }
}

async function mergeMr(args: string[], ctx?: ProjectContext): Promise<string> {
  rejectValuedMergeSwitches(args);
  // glab mr merge exposes only --squash and --rebase; with neither, GitLab
  // applies the project's configured merge method, reported as "default".
  const methods = ["squash", "rebase"].filter((candidate) =>
    takeBoolFlag(args, `--${candidate}`),
  );
  if (methods.length > 1) {
    throw new AxiError(
      "Choose only one merge method: --squash or --rebase",
      "VALIDATION_ERROR",
    );
  }
  const method = methods[0];
  const auto = takeBoolFlag(args, "--auto");
  const removeSourceBranch = takeBoolFlag(args, "--remove-source-branch");
  const message = takeFlag(args, "--message");
  const sha = takeFlag(args, "--sha");
  // Only now is every flag value consumed, so the remaining numeric token is
  // the merge request: an all-digit --sha must never be read as the number.
  const num = takeNumber(args, "merge request");

  // Idempotent: check current state with an exact match only.
  const current = await glabJson<Record<string, unknown>>(
    ["mr", "view", String(num), "-F", "json"],
    ctx,
  );
  if (exactState(current) === "merged") {
    return renderOutput([
      renderDetail(
        "mr",
        {
          ...current,
          merged_by:
            (current.merged_by as { username?: string } | null)?.username ??
            (current.merge_user as { username?: string } | null)?.username ??
            null,
          _message: "Already merged",
        },
        [
          field("iid"),
          lower("state"),
          field("merged_by"),
          field("merged_at"),
          field("_message", "message"),
        ],
      ),
      renderHelp(
        getSuggestions({ domain: "mr", action: "merge", id: num, repo: ctx }),
      ),
    ]);
  }

  const glabArgs = ["mr", "merge", String(num), "--yes"];
  // glab enables auto-merge by default whenever a pipeline is running. The axi
  // contract is deterministic mutations: merge now unless --auto is explicit.
  glabArgs.push(auto ? "--auto-merge=true" : "--auto-merge=false");
  if (method) glabArgs.push(`--${method}`);
  if (removeSourceBranch) glabArgs.push("--remove-source-branch");
  if (message) glabArgs.push("--message", message);
  if (sha) glabArgs.push("--sha", sha);

  await glabExec(glabArgs, ctx);

  return renderOutput([
    renderDetail(
      "merged",
      { iid: num, status: "ok", method: method ?? "default", auto },
      [field("iid"), field("status"), field("method"), boolYesNo("auto")],
    ),
    renderHelp(
      getSuggestions({ domain: "mr", action: "merge", id: num, repo: ctx }),
    ),
  ]);
}

async function closeMr(args: string[], ctx?: ProjectContext): Promise<string> {
  const num = requireNumber(getPositional(args, 1), "merge request");

  // Idempotent: check current state with an exact match only.
  const current = await glabJson<Record<string, unknown>>(
    ["mr", "view", String(num), "-F", "json"],
    ctx,
  );
  const state = exactState(current);
  if (state === "closed") {
    return renderOutput([
      renderDetail(
        "mr",
        { ...current, _message: "Already closed" },
        [...stateResultSchema, field("_message", "message")],
      ),
      renderHelp(
        getSuggestions({ domain: "mr", action: "close", id: num, repo: ctx }),
      ),
    ]);
  }
  if (state === "merged") {
    throw new AxiError(
      `Merge request !${num} is already merged; nothing to close`,
      "VALIDATION_ERROR",
    );
  }

  await glabExec(["mr", "close", String(num)], ctx);

  const item = await glabJson<Record<string, unknown>>(
    ["mr", "view", String(num), "-F", "json"],
    ctx,
  );

  return renderOutput([
    renderDetail("mr", item, stateResultSchema),
    renderHelp(
      getSuggestions({ domain: "mr", action: "close", id: num, repo: ctx }),
    ),
  ]);
}

async function reopenMr(args: string[], ctx?: ProjectContext): Promise<string> {
  const num = requireNumber(getPositional(args, 1), "merge request");

  // Idempotent: check current state with an exact match only.
  const current = await glabJson<Record<string, unknown>>(
    ["mr", "view", String(num), "-F", "json"],
    ctx,
  );
  const state = exactState(current);
  if (state === "opened") {
    return renderOutput([
      renderDetail(
        "mr",
        { ...current, _message: "Already opened" },
        [...stateResultSchema, field("_message", "message")],
      ),
      renderHelp(
        getSuggestions({ domain: "mr", action: "reopen", id: num, repo: ctx }),
      ),
    ]);
  }
  if (state === "merged") {
    throw new AxiError(
      `Merge request !${num} is merged and cannot be reopened`,
      "VALIDATION_ERROR",
    );
  }

  await glabExec(["mr", "reopen", String(num)], ctx);

  const item = await glabJson<Record<string, unknown>>(
    ["mr", "view", String(num), "-F", "json"],
    ctx,
  );

  return renderOutput([
    renderDetail("mr", item, stateResultSchema),
    renderHelp(
      getSuggestions({ domain: "mr", action: "reopen", id: num, repo: ctx }),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

export async function mrCommand(
  args: string[],
  ctx?: ProjectContext,
): Promise<string> {
  const sub = args[0];

  if (!sub || args.includes("--help") || args.includes("-h")) {
    return renderOutput([MR_HELP]);
  }

  switch (sub) {
    case "list":
      rejectUnknownFlags(args.slice(1), MR_FLAGS.list, "mr", "list");
      return listMrs(args, ctx);
    case "view":
      rejectUnknownFlags(args.slice(1), MR_FLAGS.view, "mr", "view");
      return viewMr(args, ctx);
    case "create":
      rejectUnknownFlags(args.slice(1), MR_FLAGS.create, "mr", "create");
      return createMr(args, ctx);
    case "merge":
      rejectUnknownFlags(args.slice(1), MR_FLAGS.merge, "mr", "merge");
      return mergeMr(args, ctx);
    case "close":
      rejectUnknownFlags(args.slice(1), MR_FLAGS.close, "mr", "close");
      return closeMr(args, ctx);
    case "reopen":
      rejectUnknownFlags(args.slice(1), MR_FLAGS.reopen, "mr", "reopen");
      return reopenMr(args, ctx);
    default:
      return renderError(`Unknown mr subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Available subcommands: list, view, create, merge, close, reopen",
        "Run `glab-axi mr --help` for usage",
      ]);
  }
}
