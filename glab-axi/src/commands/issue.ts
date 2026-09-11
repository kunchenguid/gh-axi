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
  takeBoolFlag,
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

interface IssueListItem {
  [key: string]: unknown;
  iid: number;
  title: string;
  state: string;
  author?: { username?: string };
  created_at?: string;
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

export const ISSUE_HELP = `usage: glab-axi issue <subcommand> [flags]
subcommands[4]:
  list, view <number>, create, close <number>
flags{list}:
  --state <opened|closed|all>, --label <name> (repeatable), --assignee <username> (repeatable), --author <username>, --limit <n> (default 30), --fields <a,b,c>
flags{view}:
  --full (show the complete description without truncation)
flags{create}:
  --title <text> (required), --description <text> or --description-file <path>, --assignee <username> (repeatable), --label <name> (repeatable), --milestone <id>
flags{close}:
  (none)
examples:
  glab-axi issue list --state closed --label bug
  glab-axi issue view 42
  glab-axi issue view 42 -R group/subgroup/project
  glab-axi issue create --title "Fix login" --description "Steps to reproduce..."
  glab-axi issue create --title "UI bug" --description-file repro.md
  glab-axi issue close 42`;

// ---------------------------------------------------------------------------
// Per-subcommand known flags (for rejectUnknownFlags)
// ---------------------------------------------------------------------------

export const ISSUE_FLAGS: Record<string, readonly string[]> = {
  list: [
    "--fields",
    "--state",
    "--label",
    "--assignee",
    "--author",
    "--limit",
  ],
  view: ["--full"],
  create: [
    "--title",
    "--description",
    "--description-file",
    "--assignee",
    "--label",
    "--milestone",
  ],
  close: [],
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
];

const ISSUE_LIST_EXTRA_FIELDS: Record<string, { jsonKey: string; def: FieldDef }> = {
  description: { jsonKey: "description", def: field("description") },
  labels: { jsonKey: "labels", def: joinStrings("labels") },
  url: { jsonKey: "web_url", def: field("web_url", "url") },
  updatedAt: {
    jsonKey: "updated_at",
    def: relativeTime("updated_at", "updated"),
  },
  closedAt: {
    jsonKey: "closed_at",
    def: relativeTime("closed_at", "closed"),
  },
};

const viewSchema: FieldDef[] = [
  field("iid"),
  field("title"),
  lower("state"),
  pluck("author", "username", "author"),
  relativeTime("created_at", "created"),
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
 * `closed`), never a substring, so an output-format change degrades to
 * silence, not a false positive.
 */
function exactState(item: unknown): string | undefined {
  const state = (item as { state?: unknown } | null | undefined)?.state;
  return typeof state === "string" && state.trim() !== ""
    ? state.trim().toLowerCase()
    : undefined;
}

function pushIssueStateFilter(
  glabArgs: string[],
  state: string | undefined,
): void {
  if (!state) return;
  switch (state) {
    case "opened":
      // glab issue list defaults to opened; no flag needed.
      break;
    case "closed":
      glabArgs.push("--closed");
      break;
    case "all":
      glabArgs.push("--all");
      break;
    default:
      throw new AxiError(
        `Invalid --state value: ${state}. Must be one of: opened, closed, all`,
        "VALIDATION_ERROR",
      );
  }
}

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

async function listIssues(
  args: string[],
  ctx?: ProjectContext,
): Promise<string> {
  const state = getFlag(args, "--state");
  // Validate the state even before fetching so a typo fails fast.
  pushIssueStateFilter([], state);
  const labels = getAllFlags(args, "--label");
  const assignees = getAllFlags(args, "--assignee");
  const author = getFlag(args, "--author");
  const limitRaw = getFlag(args, "--limit");
  const limit = limitRaw ? parseInt(limitRaw, 10) : 30;
  const extraDefs = collectExtraFields(getFlag(args, "--fields"), ISSUE_LIST_EXTRA_FIELDS);

  // glab issue list's -F means details|ids|urls; JSON output is -O json.
  const glabArgs = ["issue", "list", "-O", "json", "--per-page", String(limit)];
  pushIssueStateFilter(glabArgs, state);
  pushRepeated(glabArgs, "--label", labels);
  pushRepeated(glabArgs, "--assignee", assignees);
  if (author) glabArgs.push("--author", author);

  const items = await glabJson<IssueListItem[]>(glabArgs, ctx);
  const isEmpty = items.length === 0;
  const countLine = formatCountLine({ count: items.length, limit });

  const extendedSchema =
    extraDefs.length > 0 ? [...listSchema, ...extraDefs] : listSchema;
  const blocks: string[] = [
    countLine,
    renderList("issues", items, extendedSchema),
  ];
  const help = getSuggestions({
    domain: "issue",
    action: "list",
    isEmpty,
    repo: ctx,
  });
  blocks.push(renderHelp(help));

  return renderOutput(blocks);
}

async function viewIssue(
  args: string[],
  ctx?: ProjectContext,
): Promise<string> {
  const num = requireNumber(getPositional(args, 1), "issue");
  const full = takeBoolFlag(args, "--full");

  const item = await glabJson<Record<string, unknown>>(
    ["issue", "view", String(num), "-F", "json"],
    ctx,
  );
  const schema = full ? viewSchemaFull : viewSchema;
  return renderOutput([renderDetail("issue", item, schema)]);
}

async function createIssue(
  args: string[],
  ctx?: ProjectContext,
): Promise<string> {
  const title = takeRequiredFlag(args, "--title");
  if (!title) throw new AxiError("--title is required", "VALIDATION_ERROR");

  // Resolve the description ourselves (inline or file) so the child glab
  // always receives a concrete value and never opens an interactive editor.
  const description = takeDescription(args) ?? "";
  const assignees = getAllFlags(args, "--assignee");
  const labels = getAllFlags(args, "--label");
  const milestone = getFlag(args, "--milestone");

  const glabArgs = [
    "issue",
    "create",
    "--title",
    title,
    "--description",
    description,
    "--yes",
  ];
  pushRepeated(glabArgs, "--assignee", assignees);
  pushRepeated(glabArgs, "--label", labels);
  if (milestone) glabArgs.push("--milestone", milestone);

  const output = await glabExec(glabArgs, ctx);
  const urlMatch =
    output.match(/https?:\/\/\S+\/-\/issues\/(\d+)\S*/g)?.[0] ??
    output.match(/https?:\/\/\S+/)?.[0] ??
    output.trim();
  const numMatch = urlMatch.match(/\/-\/issues\/(\d+)/);
  const num = numMatch ? parseInt(numMatch[1], 10) : 0;

  // Fetch the created issue for structured output. A failure here must not
  // suggest retrying the creation.
  let item: Record<string, unknown>;
  try {
    item = await glabJson<Record<string, unknown>>(
      ["issue", "view", String(num), "-F", "json"],
      ctx,
    );
  } catch (error) {
    throw MutationFollowupError.from(urlMatch, error);
  }

  const blocks: string[] = [renderDetail("issue", item, createResultSchema)];
  const help = getSuggestions({
    domain: "issue",
    action: "create",
    id: typeof item.iid === "number" ? item.iid : num,
    repo: ctx,
  });
  blocks.push(renderHelp(help));

  return renderOutput(blocks);
}

async function closeIssue(
  args: string[],
  ctx?: ProjectContext,
): Promise<string> {
  const num = requireNumber(getPositional(args, 1), "issue");

  // Idempotent: check current state with an exact match only.
  const current = await glabJson<Record<string, unknown>>(
    ["issue", "view", String(num), "-F", "json"],
    ctx,
  );
  if (exactState(current) === "closed") {
    return renderOutput([
      renderDetail(
        "issue",
        { ...current, _message: "Already closed" },
        [...stateResultSchema, field("_message", "message")],
      ),
      renderHelp(
        getSuggestions({ domain: "issue", action: "close", id: num, repo: ctx }),
      ),
    ]);
  }

  await glabExec(["issue", "close", String(num)], ctx);

  const item = await glabJson<Record<string, unknown>>(
    ["issue", "view", String(num), "-F", "json"],
    ctx,
  );

  return renderOutput([
    renderDetail("issue", item, stateResultSchema),
    renderHelp(
      getSuggestions({ domain: "issue", action: "close", id: num, repo: ctx }),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

export async function issueCommand(
  args: string[],
  ctx?: ProjectContext,
): Promise<string> {
  const sub = args[0];

  if (!sub || args.includes("--help") || args.includes("-h")) {
    return renderOutput([ISSUE_HELP]);
  }

  switch (sub) {
    case "list":
      rejectUnknownFlags(args.slice(1), ISSUE_FLAGS.list, "issue", "list");
      return listIssues(args, ctx);
    case "view":
      rejectUnknownFlags(args.slice(1), ISSUE_FLAGS.view, "issue", "view");
      return viewIssue(args, ctx);
    case "create":
      rejectUnknownFlags(args.slice(1), ISSUE_FLAGS.create, "issue", "create");
      return createIssue(args, ctx);
    case "close":
      rejectUnknownFlags(args.slice(1), ISSUE_FLAGS.close, "issue", "close");
      return closeIssue(args, ctx);
    default:
      return renderError(
        `Unknown issue subcommand: ${sub}`,
        "VALIDATION_ERROR",
        [
          "Available subcommands: list, view, create, close",
          "Run `glab-axi issue --help` for usage",
        ],
      );
  }
}
