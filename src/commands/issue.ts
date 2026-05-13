import type { RepoContext } from "../context.js";
import { ghJson, ghExec, ghRaw } from "../gh.js";
import { AxiError, mapGhError } from "../errors.js";
import { getSuggestions } from "../suggestions.js";
import {
  getFlag,
  hasFlag,
  getPositional,
  requireNumber,
  takeFlag,
  takeBoolFlag,
} from "../args.js";
import { truncateBody } from "../body.js";
import { parseFields, type ExtraFieldSpec } from "../fields.js";
import { formatCountLine } from "../format.js";
import {
  field,
  pluck,
  joinArray,
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
  number: number;
  title: string;
  state: string;
  author: { login: string };
  createdAt: string;
  body?: string;
  comments?: IssueComment[];
}

interface IssueComment {
  [key: string]: unknown;
  author?: { login: string };
  body?: string;
  createdAt?: string;
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

export const ISSUE_HELP = `usage: gh-axi issue <subcommand> [flags]
subcommands[14]:
  list, view <number>, create, edit <number>, close <number>, reopen <number>, comment <number>, delete <number>, lock <number>, unlock <number>, pin <number>, unpin <number>, transfer <number>, subissue <add|remove|list>
flags{list}:
  --state <open|closed|all>, --label <name>, --assignee <login>, --author <login>, --milestone <name>, --sort <created|updated|comments>, --limit <n> (default 30), --fields <a,b,c>
flags{view}:
  --comments, --full (show complete body without truncation)
flags{create}:
  --title <text> (required), --body <text>, --assignee <login>, --label <name>, --milestone <name>, --type <name>
flags{edit}:
  --title, --body, --add-label, --remove-label, --add-assignee, --remove-assignee, --milestone, --type <name>, --no-type
flags{close}:
  --reason <completed|not_planned>, --comment <text>
flags{comment}:
  --body <text> (required)
flags{transfer}:
  --to-repo <owner/name> (required)
subissue:
  add <parent> <child> [<child> ...], remove <parent> <child>, list <parent>
examples:
  gh-axi issue list --state closed --label bug
  gh-axi issue view 42 --comments
  gh-axi issue create --title "Fix login" --body "Steps to reproduce..."
  gh-axi issue close 42 --reason completed
  gh-axi issue transfer 42 -R source/repo --to-repo dest/repo
  gh-axi issue subissue add 16 20 101 125
  gh-axi issue subissue list 16`;

export const SUBISSUE_HELP = `usage: gh-axi issue subissue <add|remove|list> <parent> [child...]
subcommands[3]:
  add <parent> <child> [<child> ...], remove <parent> <child>, list <parent>
examples:
  gh-axi issue subissue add 16 20 101 125
  gh-axi issue subissue remove 16 101
  gh-axi issue subissue list 16`;

// ---------------------------------------------------------------------------
// Field schemas
// ---------------------------------------------------------------------------

const listSchema: FieldDef[] = [
  field("number"),
  field("title"),
  lower("state"),
  pluck("author", "login", "author"),
  relativeTime("createdAt", "created"),
];

const issueTypeField = custom("type", (item: Record<string, unknown>) => {
  const it = item.issueType;
  if (it && typeof it === "object") {
    const name = (it as Record<string, unknown>).name;
    if (typeof name === "string" && name.length > 0) return name;
  }
  return "none";
});

const viewSchema: FieldDef[] = [
  field("number"),
  field("title"),
  lower("state"),
  pluck("author", "login", "author"),
  relativeTime("createdAt", "created"),
  issueTypeField,
  custom("body", (item: Record<string, unknown>) =>
    truncateBody(item.body, 500),
  ),
];

const viewSchemaWithoutType: FieldDef[] = viewSchema.filter(
  (f) => f !== issueTypeField,
);

const viewSchemaFull: FieldDef[] = viewSchema.map((f) =>
  "as" in f && f.as === "body"
    ? custom("body", (item: Record<string, unknown>) =>
        typeof item.body === "string" ? item.body : "",
      )
    : f,
);

const viewSchemaFullWithoutType: FieldDef[] = viewSchemaWithoutType.map((f) =>
  "as" in f && f.as === "body"
    ? custom("body", (item: Record<string, unknown>) =>
        typeof item.body === "string" ? item.body : "",
      )
    : f,
);

const createResultSchema: FieldDef[] = [
  field("number"),
  field("title"),
  lower("state"),
  field("url"),
];

const editResultSchema: FieldDef[] = [
  field("number"),
  field("title"),
  lower("state"),
  joinArray("labels", "name", "labels"),
  joinArray("assignees", "login", "assignees"),
];

const stateResultSchema: FieldDef[] = [field("number"), lower("state")];

const commentResultSchema: FieldDef[] = [
  field("number", "issue"),
  pluck("author", "login", "author"),
  relativeTime("createdAt", "created"),
  custom("body", (item: Record<string, unknown>) =>
    truncateBody(item.body, 800),
  ),
];

const lockResultSchema: FieldDef[] = [
  field("number"),
  lower("state"),
  field("locked"),
];

const pinResultSchema: FieldDef[] = [
  field("number"),
  lower("state"),
  field("isPinned", "pinned"),
];

const transferResultSchema: FieldDef[] = [field("number"), field("url")];

// ---------------------------------------------------------------------------
// Extra fields for --fields support
// ---------------------------------------------------------------------------

const ISSUE_LIST_EXTRA_FIELDS: Record<string, ExtraFieldSpec> = {
  body: { jsonKey: "body", def: field("body") },
  closedAt: { jsonKey: "closedAt", def: relativeTime("closedAt", "closed_at") },
  labels: { jsonKey: "labels", def: joinArray("labels", "name", "labels") },
  milestone: {
    jsonKey: "milestone",
    def: pluck("milestone", "title", "milestone"),
  },
  updatedAt: {
    jsonKey: "updatedAt",
    def: relativeTime("updatedAt", "updated_at"),
  },
  url: { jsonKey: "url", def: field("url") },
};

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

async function listIssues(args: string[], ctx?: RepoContext): Promise<string> {
  if (hasFlag(args, "--search")) {
    throw new AxiError(
      'issue list does not support --search. Use `gh-axi search issues "<query>"` instead for full-text search with total counts.',
      "VALIDATION_ERROR",
    );
  }
  const fieldsArg = takeFlag(args, "--fields");
  const { extraDefs, extraJsonKeys } = parseFields(
    fieldsArg,
    ISSUE_LIST_EXTRA_FIELDS,
  );
  const state = getFlag(args, "--state");
  const label = getFlag(args, "--label");
  const assignee = getFlag(args, "--assignee");
  const author = getFlag(args, "--author");
  const milestone = getFlag(args, "--milestone");
  const sort = getFlag(args, "--sort");
  const limitRaw = getFlag(args, "--limit");
  const limit = limitRaw ? parseInt(limitRaw, 10) : 30;

  const baseJsonFields = "number,title,state,author,createdAt";
  const jsonFields =
    extraJsonKeys.length > 0
      ? baseJsonFields + "," + extraJsonKeys.join(",")
      : baseJsonFields;
  const ghArgs = [
    "issue",
    "list",
    "--json",
    jsonFields,
    "--limit",
    String(limit),
  ];
  if (state) ghArgs.push("--state", state);
  if (label) ghArgs.push("--label", label);
  if (assignee) ghArgs.push("--assignee", assignee);
  if (author) ghArgs.push("--author", author);
  if (milestone) ghArgs.push("--milestone", milestone);
  if (sort) ghArgs.push("--search", `sort:${sort}-desc`);

  const items = await ghJson<IssueListItem[]>(ghArgs, ctx);
  const isEmpty = items.length === 0;

  // If we hit the limit, fetch the true totalCount via GraphQL
  let totalCount: number | undefined;
  if (items.length === limit && ctx) {
    try {
      const ghState = (state ?? "open").toUpperCase();
      const query = `{ repository(owner:"${ctx.owner}", name:"${ctx.name}") { issues(states:[${ghState}]) { totalCount } } }`;
      const gqlResult = await ghRaw(["api", "graphql", "-f", `query=${query}`]);
      if (gqlResult.exitCode === 0) {
        const parsed = JSON.parse(gqlResult.stdout);
        totalCount = parsed?.data?.repository?.issues?.totalCount ?? undefined;
      }
    } catch {
      // fall back to limit-based message
    }
  }
  const countLine = formatCountLine({ count: items.length, limit, totalCount });

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

async function viewIssue(args: string[], ctx?: RepoContext): Promise<string> {
  const num = requireNumber(getPositional(args, 1), "issue");
  const withComments = hasFlag(args, "--comments");
  const full = hasFlag(args, "--full");

  const baseFields =
    "number,title,state,author,createdAt,body" +
    (withComments ? ",comments" : "");
  const fields = baseFields + ",issueType";
  const ghArgs = ["issue", "view", String(num), "--json", fields];

  let item: Record<string, unknown>;
  let supportsIssueType = true;
  try {
    item = await ghJson<Record<string, unknown>>(ghArgs, ctx);
  } catch (e) {
    if (e instanceof AxiError && /issueType/i.test(e.message)) {
      supportsIssueType = false;
      item = await ghJson<Record<string, unknown>>(
        ["issue", "view", String(num), "--json", baseFields],
        ctx,
      );
    } else {
      throw e;
    }
  }

  const baseSchema = supportsIssueType
    ? full
      ? viewSchemaFull
      : viewSchema
    : full
      ? viewSchemaFullWithoutType
      : viewSchemaWithoutType;

  // Best-effort augmentation with sub-issue relationships. The sub-issues API
  // is only available via GraphQL and requires repo context; failures here
  // should not block the primary view output.
  let parentNum: number | null = null;
  let childNums: number[] = [];
  if (ctx) {
    try {
      const rel = await fetchSubIssueRelationships(num, ctx);
      parentNum = rel.parent;
      childNums = rel.subIssues;
    } catch {
      // Sub-issues are a preview feature on some repos; ignore failures.
    }
  }

  const schema: FieldDef[] = [...baseSchema];
  const augmented: Record<string, unknown> = { ...item };
  if (childNums.length > 0) {
    augmented._subissues = childNums.map((n) => `#${n}`);
    schema.push(custom("subissues", (it) => it._subissues));
  }
  if (parentNum != null) {
    augmented._parent = `#${parentNum}`;
    schema.push(custom("parent", (it) => it._parent));
  }

  const blocks: string[] = [renderDetail("issue", augmented, schema)];

  if (withComments && Array.isArray(item.comments)) {
    blocks.push(
      renderList(
        "comments",
        item.comments as Record<string, unknown>[],
        commentResultSchema.filter((d) =>
          "key" in d ? d.key !== "number" : true,
        ),
      ),
    );
  }

  return renderOutput(blocks);
}

interface ResolvedIssueType {
  id: string;
  name: string;
}

function getOptionalRequiredFlag(
  args: string[],
  name: string,
): string | undefined {
  if (!hasFlag(args, name)) return undefined;
  const value = getFlag(args, name);
  if (value === undefined || value.trim() === "" || value.startsWith("--")) {
    throw new AxiError(`${name} requires a value`, "VALIDATION_ERROR");
  }
  return value;
}

async function getOwnerName(
  ctx?: RepoContext,
): Promise<{ owner: string; name: string }> {
  if (ctx) return { owner: ctx.owner, name: ctx.name };
  const repo = await ghJson<{ owner: { login: string }; name: string }>([
    "repo",
    "view",
    "--json",
    "owner,name",
  ]);
  return { owner: repo.owner.login, name: repo.name };
}

async function resolveIssueType(
  typeName: string,
  ctx?: RepoContext,
): Promise<ResolvedIssueType> {
  const { owner, name } = await getOwnerName(ctx);
  const query =
    "query($owner:String!,$name:String!){repository(owner:$owner,name:$name){issueTypes(first:25){nodes{id name}}}}";
  const result = await ghRaw([
    "api",
    "graphql",
    "-f",
    `owner=${owner}`,
    "-f",
    `name=${name}`,
    "-f",
    `query=${query}`,
  ]);
  if (result.exitCode !== 0) {
    throw mapGhError(result.stderr, result.exitCode);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new AxiError("Unable to resolve issue types from GitHub", "UNKNOWN");
  }
  const nodes = (
    parsed as {
      data?: {
        repository?: {
          issueTypes?: { nodes?: Array<{ id: string; name: string }> };
        };
      };
    }
  )?.data?.repository?.issueTypes?.nodes;
  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw new AxiError(
      `Issue types are not configured for this repository. Enable them in repo settings before using --type.`,
      "VALIDATION_ERROR",
    );
  }
  const wanted = typeName.toLowerCase();
  const match = nodes.find(
    (n) => typeof n?.name === "string" && n.name.toLowerCase() === wanted,
  );
  if (!match) {
    const available = nodes
      .map((n) => n?.name)
      .filter((s): s is string => typeof s === "string");
    throw new AxiError(
      `Unknown issue type "${typeName}". Available types: ${available.join(", ")}`,
      "VALIDATION_ERROR",
    );
  }
  return { id: match.id, name: match.name };
}

async function applyIssueType(
  issueNodeId: string,
  typeId: string | null,
): Promise<void> {
  const mutation =
    typeId === null
      ? `mutation($id:ID!){updateIssue(input:{id:$id,issueTypeId:null}){issue{id}}}`
      : `mutation($id:ID!,$typeId:ID!){updateIssue(input:{id:$id,issueTypeId:$typeId}){issue{id}}}`;
  const args = ["api", "graphql", "-f", `id=${issueNodeId}`];
  if (typeId !== null) args.push("-f", `typeId=${typeId}`);
  args.push("-f", `query=${mutation}`);
  const result = await ghRaw(args);
  if (result.exitCode !== 0) {
    throw mapGhError(result.stderr, result.exitCode);
  }
}

async function createIssue(args: string[], ctx?: RepoContext): Promise<string> {
  const title = getFlag(args, "--title");
  if (!title) throw new AxiError("--title is required", "VALIDATION_ERROR");

  const body = getFlag(args, "--body");
  const assignee = getFlag(args, "--assignee");
  const label = getFlag(args, "--label");
  const milestone = getFlag(args, "--milestone");
  const project = getFlag(args, "--project");
  const typeName = getOptionalRequiredFlag(args, "--type");

  // Resolve type up front so an invalid value fails before creating the issue.
  let resolvedType: ResolvedIssueType | undefined;
  if (typeName) {
    resolvedType = await resolveIssueType(typeName, ctx);
  }

  const ghArgs = ["issue", "create", "--title", title];
  if (body) ghArgs.push("--body", body);
  if (assignee) ghArgs.push("--assignee", assignee);
  if (label) ghArgs.push("--label", label);
  if (milestone) ghArgs.push("--milestone", milestone);
  if (project) ghArgs.push("--project", project);

  // gh issue create outputs the URL; use --json to get structured data
  // Unfortunately gh issue create doesn't support --json, so we parse the URL
  const output = await ghExec(ghArgs, ctx);
  const urlMatch = output.match(/https:\/\/github\.com\/[^\s]+/);
  const url = urlMatch ? urlMatch[0] : output.trim();
  const numMatch = url.match(/\/issues\/(\d+)/);
  const num = numMatch ? parseInt(numMatch[1], 10) : 0;

  // Fetch the created issue for structured output; include id for type mutation
  const item = await ghJson<Record<string, unknown>>(
    ["issue", "view", String(num), "--json", "number,title,state,url,id"],
    ctx,
  );

  if (resolvedType) {
    const issueNodeId = item.id;
    if (typeof issueNodeId === "string" && issueNodeId.length > 0) {
      await applyIssueType(issueNodeId, resolvedType.id);
    }
    item.issueType = { name: resolvedType.name };
  }

  const schema = resolvedType
    ? [...createResultSchema, issueTypeField]
    : createResultSchema;
  const blocks: string[] = [renderDetail("issue", item, schema)];
  const help = getSuggestions({
    domain: "issue",
    action: "create",
    id: num,
    repo: ctx,
  });
  blocks.push(renderHelp(help));

  return renderOutput(blocks);
}

async function editIssue(args: string[], ctx?: RepoContext): Promise<string> {
  const num = requireNumber(getPositional(args, 1), "issue");

  const title = getFlag(args, "--title");
  const body = getFlag(args, "--body");
  const addLabel = getFlag(args, "--add-label");
  const removeLabel = getFlag(args, "--remove-label");
  const addAssignee = getFlag(args, "--add-assignee");
  const removeAssignee = getFlag(args, "--remove-assignee");
  const milestone = getFlag(args, "--milestone");
  const clearType = takeBoolFlag(args, "--no-type");
  const typeName = getOptionalRequiredFlag(args, "--type");
  const clearTypeFlag = clearType;

  // Resolve type up front so an invalid value fails before mutating the issue.
  let resolvedType: ResolvedIssueType | undefined;
  if (typeName) {
    resolvedType = await resolveIssueType(typeName, ctx);
  }

  const ghArgs = ["issue", "edit", String(num)];
  if (title) ghArgs.push("--title", title);
  if (body) ghArgs.push("--body", body);
  if (addLabel) ghArgs.push("--add-label", addLabel);
  if (removeLabel) ghArgs.push("--remove-label", removeLabel);
  if (addAssignee) ghArgs.push("--add-assignee", addAssignee);
  if (removeAssignee) ghArgs.push("--remove-assignee", removeAssignee);
  if (milestone) ghArgs.push("--milestone", milestone);

  // Only call `gh issue edit` if there is a non-type field to update; otherwise
  // calling with just the issue number errors out.
  if (ghArgs.length > 3) {
    await ghExec(ghArgs, ctx);
  }

  // Fetch updated issue (include id for type mutation)
  const item = await ghJson<Record<string, unknown>>(
    [
      "issue",
      "view",
      String(num),
      "--json",
      "number,title,state,labels,assignees,id",
    ],
    ctx,
  );

  if (resolvedType || clearTypeFlag) {
    const issueNodeId = item.id;
    if (typeof issueNodeId === "string" && issueNodeId.length > 0) {
      await applyIssueType(issueNodeId, resolvedType ? resolvedType.id : null);
    }
    item.issueType = resolvedType ? { name: resolvedType.name } : null;
  }

  const schema =
    resolvedType || clearTypeFlag
      ? [...editResultSchema, issueTypeField]
      : editResultSchema;
  const blocks: string[] = [renderDetail("issue", item, schema)];
  const help = getSuggestions({
    domain: "issue",
    action: "edit",
    id: num,
    repo: ctx,
  });
  blocks.push(renderHelp(help));

  return renderOutput(blocks);
}

async function closeIssue(args: string[], ctx?: RepoContext): Promise<string> {
  const num = requireNumber(getPositional(args, 1), "issue");
  const reason = getFlag(args, "--reason");
  const comment = getFlag(args, "--comment");

  // Idempotent: check current state
  const current = await ghJson<{ state: string }>(
    ["issue", "view", String(num), "--json", "state"],
    ctx,
  );
  if (current.state.toLowerCase() === "closed") {
    const item = await ghJson<Record<string, unknown>>(
      ["issue", "view", String(num), "--json", "number,state"],
      ctx,
    );
    const blocks: string[] = [
      renderDetail("issue", { ...item, _message: "Already closed" }, [
        ...stateResultSchema,
        field("_message", "message"),
      ]),
    ];
    const help = getSuggestions({
      domain: "issue",
      action: "close",
      id: num,
      repo: ctx,
    });
    blocks.push(renderHelp(help));
    return renderOutput(blocks);
  }

  const ghArgs = ["issue", "close", String(num)];
  if (reason) ghArgs.push("--reason", reason);
  if (comment) ghArgs.push("--comment", comment);

  await ghExec(ghArgs, ctx);

  const item = await ghJson<Record<string, unknown>>(
    ["issue", "view", String(num), "--json", "number,state"],
    ctx,
  );

  const blocks: string[] = [renderDetail("issue", item, stateResultSchema)];
  const help = getSuggestions({
    domain: "issue",
    action: "close",
    id: num,
    repo: ctx,
  });
  blocks.push(renderHelp(help));

  return renderOutput(blocks);
}

async function reopenIssue(args: string[], ctx?: RepoContext): Promise<string> {
  const num = requireNumber(getPositional(args, 1), "issue");

  // Idempotent: check current state
  const current = await ghJson<{ state: string }>(
    ["issue", "view", String(num), "--json", "state"],
    ctx,
  );
  if (current.state.toLowerCase() === "open") {
    const item = await ghJson<Record<string, unknown>>(
      ["issue", "view", String(num), "--json", "number,state"],
      ctx,
    );
    const blocks: string[] = [
      renderDetail("issue", { ...item, _message: "Already open" }, [
        ...stateResultSchema,
        field("_message", "message"),
      ]),
    ];
    const help = getSuggestions({
      domain: "issue",
      action: "reopen",
      id: num,
      repo: ctx,
    });
    blocks.push(renderHelp(help));
    return renderOutput(blocks);
  }

  await ghExec(["issue", "reopen", String(num)], ctx);

  const item = await ghJson<Record<string, unknown>>(
    ["issue", "view", String(num), "--json", "number,state"],
    ctx,
  );

  const blocks: string[] = [renderDetail("issue", item, stateResultSchema)];
  const help = getSuggestions({
    domain: "issue",
    action: "reopen",
    id: num,
    repo: ctx,
  });
  blocks.push(renderHelp(help));

  return renderOutput(blocks);
}

async function commentOnIssue(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const num = requireNumber(getPositional(args, 1), "issue");
  const body = getFlag(args, "--body");
  if (!body) throw new AxiError("--body is required", "VALIDATION_ERROR");

  await ghExec(["issue", "comment", String(num), "--body", body], ctx);

  // Fetch the latest comment
  const issue = await ghJson<{ comments: IssueComment[] }>(
    ["issue", "view", String(num), "--json", "comments"],
    ctx,
  );
  const lastComment = issue.comments[issue.comments.length - 1];
  const commentItem = { ...lastComment, number: num };

  const blocks: string[] = [
    renderDetail("comment", commentItem, commentResultSchema),
  ];
  const help = getSuggestions({
    domain: "issue",
    action: "comment",
    id: num,
    repo: ctx,
  });
  blocks.push(renderHelp(help));

  return renderOutput(blocks);
}

async function deleteIssue(args: string[], ctx?: RepoContext): Promise<string> {
  const num = requireNumber(getPositional(args, 1), "issue");

  await ghExec(["issue", "delete", String(num), "--yes"], ctx);

  const blocks: string[] = [
    renderDetail("issue", { number: num, status: "deleted" }, [
      field("number"),
      field("status"),
    ]),
  ];
  const help = getSuggestions({
    domain: "issue",
    action: "delete",
    id: num,
    repo: ctx,
  });
  blocks.push(renderHelp(help));

  return renderOutput(blocks);
}

async function lockIssue(args: string[], ctx?: RepoContext): Promise<string> {
  const num = requireNumber(getPositional(args, 1), "issue");

  // Idempotent: check current locked state
  const current = await ghJson<{ locked: boolean; state: string }>(
    ["issue", "view", String(num), "--json", "state,locked"],
    ctx,
  );
  if (current.locked) {
    const item = {
      number: num,
      state: current.state,
      locked: true,
      _message: "Already locked",
    };
    const blocks: string[] = [
      renderDetail("issue", item, [
        ...lockResultSchema,
        field("_message", "message"),
      ]),
    ];
    const help = getSuggestions({
      domain: "issue",
      action: "lock",
      id: num,
      repo: ctx,
    });
    blocks.push(renderHelp(help));
    return renderOutput(blocks);
  }

  await ghExec(["issue", "lock", String(num)], ctx);

  const item = await ghJson<Record<string, unknown>>(
    ["issue", "view", String(num), "--json", "number,state,locked"],
    ctx,
  );

  const blocks: string[] = [renderDetail("issue", item, lockResultSchema)];
  const help = getSuggestions({
    domain: "issue",
    action: "lock",
    id: num,
    repo: ctx,
  });
  blocks.push(renderHelp(help));

  return renderOutput(blocks);
}

async function unlockIssue(args: string[], ctx?: RepoContext): Promise<string> {
  const num = requireNumber(getPositional(args, 1), "issue");

  // Idempotent: check current locked state
  const current = await ghJson<{ locked: boolean; state: string }>(
    ["issue", "view", String(num), "--json", "state,locked"],
    ctx,
  );
  if (!current.locked) {
    const item = {
      number: num,
      state: current.state,
      locked: false,
      _message: "Already unlocked",
    };
    const blocks: string[] = [
      renderDetail("issue", { ...item }, [
        ...lockResultSchema,
        field("_message", "message"),
      ]),
    ];
    const help = getSuggestions({
      domain: "issue",
      action: "unlock",
      id: num,
      repo: ctx,
    });
    blocks.push(renderHelp(help));
    return renderOutput(blocks);
  }

  await ghExec(["issue", "unlock", String(num)], ctx);

  const item = await ghJson<Record<string, unknown>>(
    ["issue", "view", String(num), "--json", "number,state,locked"],
    ctx,
  );

  const blocks: string[] = [renderDetail("issue", item, lockResultSchema)];
  const help = getSuggestions({
    domain: "issue",
    action: "unlock",
    id: num,
    repo: ctx,
  });
  blocks.push(renderHelp(help));

  return renderOutput(blocks);
}

async function pinIssue(args: string[], ctx?: RepoContext): Promise<string> {
  const num = requireNumber(getPositional(args, 1), "issue");

  // Idempotent: check current pinned state
  const current = await ghJson<{ isPinned: boolean; state: string }>(
    ["issue", "view", String(num), "--json", "state,isPinned"],
    ctx,
  );
  if (current.isPinned) {
    const item = {
      number: num,
      state: current.state,
      isPinned: true,
      _message: "Already pinned",
    };
    const blocks: string[] = [
      renderDetail("issue", item, [
        ...pinResultSchema,
        field("_message", "message"),
      ]),
    ];
    const help = getSuggestions({
      domain: "issue",
      action: "pin",
      id: num,
      repo: ctx,
    });
    blocks.push(renderHelp(help));
    return renderOutput(blocks);
  }

  await ghExec(["issue", "pin", String(num)], ctx);

  const item = await ghJson<Record<string, unknown>>(
    ["issue", "view", String(num), "--json", "number,state,isPinned"],
    ctx,
  );

  const blocks: string[] = [renderDetail("issue", item, pinResultSchema)];
  const help = getSuggestions({
    domain: "issue",
    action: "pin",
    id: num,
    repo: ctx,
  });
  blocks.push(renderHelp(help));

  return renderOutput(blocks);
}

async function unpinIssue(args: string[], ctx?: RepoContext): Promise<string> {
  const num = requireNumber(getPositional(args, 1), "issue");

  // Idempotent: check current pinned state
  const current = await ghJson<{ isPinned: boolean; state: string }>(
    ["issue", "view", String(num), "--json", "state,isPinned"],
    ctx,
  );
  if (!current.isPinned) {
    const item = {
      number: num,
      state: current.state,
      isPinned: false,
      _message: "Already unpinned",
    };
    const blocks: string[] = [
      renderDetail("issue", item, [
        ...pinResultSchema,
        field("_message", "message"),
      ]),
    ];
    const help = getSuggestions({
      domain: "issue",
      action: "unpin",
      id: num,
      repo: ctx,
    });
    blocks.push(renderHelp(help));
    return renderOutput(blocks);
  }

  await ghExec(["issue", "unpin", String(num)], ctx);

  const item = await ghJson<Record<string, unknown>>(
    ["issue", "view", String(num), "--json", "number,state,isPinned"],
    ctx,
  );

  const blocks: string[] = [renderDetail("issue", item, pinResultSchema)];
  const help = getSuggestions({
    domain: "issue",
    action: "unpin",
    id: num,
    repo: ctx,
  });
  blocks.push(renderHelp(help));

  return renderOutput(blocks);
}

async function transferIssue(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const num = requireNumber(getPositional(args, 1), "issue");
  const destRepo = getFlag(args, "--to-repo");
  if (!destRepo)
    throw new AxiError(
      "--to-repo is required for transfer",
      "VALIDATION_ERROR",
    );

  await ghExec(["issue", "transfer", String(num), destRepo], ctx);

  // After transfer the issue gets a new URL; try to get it from the output
  // The transferred issue may have a new number in the target repo.
  // We can fetch by the original number since gh resolves it via redirect.
  let item: { number: number; url: string };
  try {
    item = await ghJson<{ number: number; url: string }>([
      "issue",
      "view",
      String(num),
      "--json",
      "number,url",
      "--repo",
      destRepo,
    ]);
  } catch {
    // Fallback: return what we know
    item = { number: num, url: `https://github.com/${destRepo}/issues/${num}` };
  }

  const blocks: string[] = [renderDetail("issue", item, transferResultSchema)];
  const help = getSuggestions({
    domain: "issue",
    action: "transfer",
    id: num,
    repo: ctx,
  });
  blocks.push(renderHelp(help));

  return renderOutput(blocks);
}

// ---------------------------------------------------------------------------
// Sub-issue helpers
// ---------------------------------------------------------------------------

interface ResolvedIssue {
  id: string;
  number: number;
}

interface SubIssueNode {
  [key: string]: unknown;
  number: number;
  title?: string;
  state?: string;
}

function requireRepo(ctx?: RepoContext): RepoContext {
  if (!ctx) {
    throw new AxiError(
      "Could not determine repository — pass --repo <owner/name> or run inside a git checkout",
      "VALIDATION_ERROR",
    );
  }
  return ctx;
}

async function gqlRequest<T>(query: string, ctx?: RepoContext): Promise<T> {
  // Don't pass ctx through to ghJson — `gh api graphql` ignores --repo, and
  // passing it produces a deprecation warning. The owner/name are baked into
  // the query string instead.
  void ctx;
  const data = await ghJson<{ data: T }>([
    "api",
    "graphql",
    "-f",
    `query=${query}`,
  ]);
  return data.data;
}

async function resolveIssueIds(
  parent: number,
  children: number[],
  ctx: RepoContext,
): Promise<{ parent: ResolvedIssue; children: ResolvedIssue[] }> {
  const childFields = children
    .map((n, i) => `c${i}: issue(number: ${n}) { id number }`)
    .join(" ");
  const query = `query { repository(owner: "${ctx.owner}", name: "${ctx.name}") { parent: issue(number: ${parent}) { id number } ${childFields} } }`;
  const result = await gqlRequest<{
    repository: Record<string, ResolvedIssue | null>;
  }>(query, ctx);

  const repo = result.repository ?? {};
  const parentNode = repo.parent;
  if (!parentNode) {
    throw new AxiError(`Issue #${parent} not found in ${ctx.nwo}`, "NOT_FOUND");
  }
  const childNodes: ResolvedIssue[] = [];
  for (let i = 0; i < children.length; i++) {
    const node = repo[`c${i}`];
    if (!node) {
      throw new AxiError(
        `Issue #${children[i]} not found in ${ctx.nwo}`,
        "NOT_FOUND",
      );
    }
    childNodes.push(node);
  }
  return { parent: parentNode, children: childNodes };
}

async function subissueAdd(args: string[], ctx?: RepoContext): Promise<string> {
  const repo = requireRepo(ctx);
  const parentRaw = args[2];
  const childRaw = args.slice(3).filter((a) => !a.startsWith("--"));
  const parentNum = requireNumber(parentRaw, "parent");
  if (childRaw.length === 0) {
    throw new AxiError(
      "subissue add requires at least one child issue number",
      "VALIDATION_ERROR",
    );
  }
  const childNums = childRaw.map((r) => requireNumber(r, "child"));

  const { parent, children } = await resolveIssueIds(
    parentNum,
    childNums,
    repo,
  );

  const addedNumbers: number[] = [];
  for (const child of children) {
    const mutation = `mutation { addSubIssue(input: { issueId: "${parent.id}", subIssueId: "${child.id}" }) { subIssue { number } } }`;
    let result: { addSubIssue?: { subIssue?: { number?: number } } };
    try {
      result = await gqlRequest<{
        addSubIssue?: { subIssue?: { number?: number } };
      }>(mutation, repo);
    } catch (error) {
      if (addedNumbers.length === 0) throw error;
      const added = addedNumbers.map((n) => `#${n}`).join(", ");
      if (error instanceof AxiError) {
        throw new AxiError(
          `${error.message}\nAdded before failure: ${added}`,
          error.code,
        );
      }
      throw new AxiError(
        `Failed to add sub-issue #${child.number}\nAdded before failure: ${added}`,
        "UNKNOWN",
      );
    }
    const r = result.addSubIssue;
    if (r?.subIssue?.number != null) addedNumbers.push(r.subIssue.number);
    else addedNumbers.push(child.number);
  }

  const item = {
    parent: `#${parent.number}`,
    added: addedNumbers.map((n) => `#${n}`),
  };
  const blocks: string[] = [
    renderDetail("subissue_add", item, [
      field("parent"),
      custom("added", (it: Record<string, unknown>) => it.added),
    ]),
  ];
  blocks.push(
    renderHelp([
      `Run \`gh-axi issue view ${parent.number}\` to see the parent with its sub-issues`,
    ]),
  );
  return renderOutput(blocks);
}

async function subissueRemove(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const repo = requireRepo(ctx);
  const parentRaw = args[2];
  const childRaw = args[3];
  const parentNum = requireNumber(parentRaw, "parent");
  if (!childRaw) {
    throw new AxiError(
      "subissue remove requires a child issue number",
      "VALIDATION_ERROR",
    );
  }
  const childNum = requireNumber(childRaw, "child");

  const { parent, children } = await resolveIssueIds(
    parentNum,
    [childNum],
    repo,
  );
  const child = children[0];

  const mutation = `mutation { removeSubIssue(input: { issueId: "${parent.id}", subIssueId: "${child.id}" }) { issue { number } } }`;
  await gqlRequest<unknown>(mutation, repo);

  const item = {
    parent: `#${parent.number}`,
    removed: `#${child.number}`,
  };
  const blocks: string[] = [
    renderDetail("subissue_remove", item, [field("parent"), field("removed")]),
  ];
  blocks.push(
    renderHelp([
      `Run \`gh-axi issue subissue list ${parent.number}\` to see remaining sub-issues`,
    ]),
  );
  return renderOutput(blocks);
}

async function subissueList(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const repo = requireRepo(ctx);
  const parentRaw = args[2];
  const parentNum = requireNumber(parentRaw, "parent");

  const query = `query { repository(owner: "${repo.owner}", name: "${repo.name}") { issue(number: ${parentNum}) { subIssues(first: 100) { totalCount nodes { number title state } } } } }`;
  const data = await gqlRequest<{
    repository: {
      issue: {
        subIssues: { totalCount: number; nodes: SubIssueNode[] };
      } | null;
    };
  }>(query, repo);

  const issue = data.repository?.issue;
  if (!issue) {
    throw new AxiError(
      `Issue #${parentNum} not found in ${repo.nwo}`,
      "NOT_FOUND",
    );
  }

  const nodes = issue.subIssues.nodes ?? [];
  const totalCount = issue.subIssues.totalCount ?? nodes.length;
  const countLine = formatCountLine({
    count: nodes.length,
    limit: 100,
    totalCount,
  });

  const schema: FieldDef[] = [field("number"), field("title"), lower("state")];

  const blocks: string[] = [
    `parent: #${parentNum}`,
    countLine,
    renderList("subissues", nodes as Record<string, unknown>[], schema),
  ];
  return renderOutput(blocks);
}

async function fetchSubIssueRelationships(
  num: number,
  ctx: RepoContext,
): Promise<{ parent: number | null; subIssues: number[] }> {
  const query = `query { repository(owner: "${ctx.owner}", name: "${ctx.name}") { issue(number: ${num}) { parent { number } subIssues(first: 100) { totalCount nodes { number } } } } }`;
  const data = await gqlRequest<{
    repository: {
      issue: {
        parent: { number: number } | null;
        subIssues: { totalCount: number; nodes: { number: number }[] };
      } | null;
    };
  }>(query, ctx);
  const issue = data.repository?.issue;
  if (!issue) return { parent: null, subIssues: [] };
  return {
    parent: issue.parent?.number ?? null,
    subIssues: (issue.subIssues?.nodes ?? []).map((n) => n.number),
  };
}

async function subissueCommand(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const sub = args[1];
  if (!sub || hasFlag(args, "--help")) {
    return renderOutput([SUBISSUE_HELP]);
  }
  switch (sub) {
    case "add":
      return subissueAdd(args, ctx);
    case "remove":
      return subissueRemove(args, ctx);
    case "list":
      return subissueList(args, ctx);
    default:
      return renderError(
        `Unknown subissue subcommand: ${sub}`,
        "VALIDATION_ERROR",
        ["Run `gh-axi issue subissue --help` for usage"],
      );
  }
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

export async function issueCommand(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const sub = args[0];

  if (sub === "subissue") {
    return subissueCommand(args, ctx);
  }

  if (!sub || hasFlag(args, "--help")) {
    const blocks: string[] = [ISSUE_HELP];
    const help = getSuggestions({ domain: "issue", action: "help", repo: ctx });
    if (help.length > 0) blocks.push(renderHelp(help));
    return renderOutput(blocks);
  }

  switch (sub) {
    case "list":
      return listIssues(args, ctx);
    case "view":
      return viewIssue(args, ctx);
    case "create":
      return createIssue(args, ctx);
    case "edit":
      return editIssue(args, ctx);
    case "close":
      return closeIssue(args, ctx);
    case "reopen":
      return reopenIssue(args, ctx);
    case "comment":
      return commentOnIssue(args, ctx);
    case "delete":
      return deleteIssue(args, ctx);
    case "lock":
      return lockIssue(args, ctx);
    case "unlock":
      return unlockIssue(args, ctx);
    case "pin":
      return pinIssue(args, ctx);
    case "unpin":
      return unpinIssue(args, ctx);
    case "transfer":
      return transferIssue(args, ctx);
    default:
      return renderError(
        `Unknown issue subcommand: ${sub}`,
        "VALIDATION_ERROR",
        ["Run `gh-axi issue --help` for usage"],
      );
  }
}
