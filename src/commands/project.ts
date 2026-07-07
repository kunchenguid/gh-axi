import { encode } from "@toon-format/toon";
import type { RepoContext } from "../context.js";
import { ghJson } from "../gh.js";
import { AxiError } from "../errors.js";
import { takeBody, truncateBody } from "../body.js";
import { formatCountLine } from "../format.js";
import { getSuggestions } from "../suggestions.js";
import { takeFlag, takeBoolFlag, takeNumber } from "../args.js";
import {
  field,
  pluck,
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

interface ProjectRecord {
  id?: string;
  number?: number;
  title?: string;
  url?: string;
  closed?: boolean;
  public?: boolean;
  shortDescription?: string;
  owner?: { login?: string; type?: string };
  items?: { totalCount?: number };
  fields?: { totalCount?: number };
}

type ProjectItem = Record<string, unknown>;

interface ProjectListResult {
  projects?: ProjectRecord[];
  totalCount?: number;
}

interface ProjectItemListResult {
  items?: ProjectItem[];
  totalCount?: number;
}

interface ProjectFieldListResult {
  fields?: ProjectItem[];
  totalCount?: number;
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

export const PROJECT_HELP = `usage: gh-axi project <subcommand> [flags]
subcommands[13]:
  list, view <number>, item-list <number>, field-list <number>, item-add <number>, item-create <number>, item-edit, item-archive <number>, item-delete <number>, create, edit <number>, close <number>, copy <number>
flags{list}:
  --owner <login>, --closed, --limit <n> (default 30)
flags{view}:
  --owner <login>
flags{item-list}:
  --owner <login>, --query <filter>, --limit <n> (default 30)
flags{field-list}:
  --owner <login>, --limit <n> (default 30)
flags{item-add}:
  --owner <login>, --url <text> (required)
flags{item-create}:
  --owner <login>, --title <text> (required), --body <text> or --body-file <path>
flags{item-edit}:
  --id <text> (required), --project-id <text>, --field-id <text>, --text <text>, --number <n>, --date <YYYY-MM-DD>, --single-select-option-id <text>, --iteration-id <text>, --title <text>, --body <text> or --body-file <path>, --clear
flags{item-archive}:
  --owner <login>, --id <text> (required), --undo
flags{item-delete}:
  --owner <login>, --id <text> (required)
flags{create}:
  --owner <login>, --title <text> (required)
flags{edit}:
  --owner <login>, --title <text>, --description <text>, --readme <text>, --visibility <PUBLIC|PRIVATE>
flags{close}:
  --owner <login>, --undo
flags{copy}:
  --source-owner <login>, --target-owner <login> (required), --title <text> (required), --drafts
notes:
  --owner defaults to the current repo's owner when run inside a repo, otherwise the authenticated user.
  Requires the \`project\` (or \`read:project\`) OAuth scope — run \`gh auth refresh -s project\` if a call fails with a scope error.
examples:
  gh-axi project list --owner my-org
  gh-axi project view 3 --owner my-org
  gh-axi project item-add 3 --owner my-org --url https://github.com/my-org/repo/issues/12
  gh-axi project item-list 3 --owner my-org
  gh-axi project create --owner my-org --title "Roadmap"`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveOwner(args: string[], ctx?: RepoContext): string | undefined {
  return takeFlag(args, "--owner") ?? ctx?.owner;
}

function ownerArgs(owner: string | undefined): string[] {
  return owner ? ["--owner", owner] : [];
}

const KNOWN_ITEM_KEYS = new Set([
  "id",
  "title",
  "type",
  "number",
  "repository",
  "body",
  "url",
  "labels",
  "assignees",
  "reviewers",
  "milestone",
  "content",
]);

/** Render project items, surfacing any custom project field (Status, Priority, ...) as a flat column. */
function renderProjectItems(items: ProjectItem[]): string {
  const rows = items.map((item) => {
    const row: Record<string, unknown> = {
      id: item.id ?? null,
      title: item.title ?? null,
      type: item.type ?? null,
    };
    if (item.number !== undefined) row.number = item.number;
    if (item.repository !== undefined) row.repository = item.repository;
    if (Array.isArray(item.labels) && item.labels.length > 0)
      row.labels = (item.labels as unknown[]).join(",");
    if (Array.isArray(item.assignees) && item.assignees.length > 0)
      row.assignees = (item.assignees as unknown[]).join(",");
    if (typeof item.body === "string" && item.body)
      row.body = truncateBody(item.body, 300);
    for (const [key, value] of Object.entries(item)) {
      if (
        !KNOWN_ITEM_KEYS.has(key) &&
        value !== null &&
        value !== undefined &&
        typeof value !== "object"
      ) {
        row[key] = value;
      }
    }
    if (item.url !== undefined) row.url = item.url;
    return row;
  });
  return encode({ items: rows });
}

function renderProjectFields(fields: ProjectItem[]): string {
  const rows = fields.map((f) => {
    const row: Record<string, unknown> = {
      id: f.id ?? null,
      name: f.name ?? null,
      type: f.type ?? null,
    };
    if (Array.isArray(f.options) && f.options.length > 0) {
      row.options = (f.options as ProjectItem[])
        .map((o) => (o && typeof o === "object" && "name" in o ? o.name : o))
        .join(",");
    }
    return row;
  });
  return encode({ fields: rows });
}

const projectListSchema: FieldDef[] = [
  field("number"),
  field("title"),
  custom("state", (item: ProjectRecord) => (item.closed ? "closed" : "open")),
  pluck("owner", "login", "owner"),
  field("url"),
];

const projectViewSchema: FieldDef[] = [
  field("number"),
  field("title"),
  custom("state", (item: ProjectRecord) => (item.closed ? "closed" : "open")),
  custom("visibility", (item: ProjectRecord) =>
    item.public ? "public" : "private",
  ),
  pluck("owner", "login", "owner"),
  field("shortDescription", "description"),
  pluck("items", "totalCount", "item_count"),
  pluck("fields", "totalCount", "field_count"),
  field("url"),
];

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

async function projectList(args: string[], ctx?: RepoContext): Promise<string> {
  const owner = resolveOwner(args, ctx);
  const closed = takeBoolFlag(args, "--closed");
  const limit = takeFlag(args, "--limit") ?? "30";

  const ghArgs = [
    "project",
    "list",
    "--format",
    "json",
    "--limit",
    limit,
    ...ownerArgs(owner),
  ];
  if (closed) ghArgs.push("--closed");

  const result = await ghJson<ProjectListResult>(ghArgs);
  const projects = result.projects ?? [];
  const isEmpty = projects.length === 0;

  const countLine = formatCountLine({
    count: projects.length,
    limit: Number(limit),
    totalCount: result.totalCount,
  });

  return renderOutput([
    countLine,
    renderList("projects", projects, projectListSchema),
    renderHelp(
      getSuggestions({ domain: "project", action: "list", isEmpty, owner }),
    ),
  ]);
}

async function projectView(args: string[], ctx?: RepoContext): Promise<string> {
  const owner = resolveOwner(args, ctx);
  const num = takeNumber(args, "project");

  const ghArgs = [
    "project",
    "view",
    String(num),
    "--format",
    "json",
    ...ownerArgs(owner),
  ];

  const project = await ghJson<ProjectRecord>(ghArgs);
  return renderOutput([
    renderDetail("project", project, projectViewSchema),
  ]);
}

async function projectItemList(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const owner = resolveOwner(args, ctx);
  const num = takeNumber(args, "project");
  const query = takeFlag(args, "--query");
  const limit = takeFlag(args, "--limit") ?? "30";

  const ghArgs = [
    "project",
    "item-list",
    String(num),
    "--format",
    "json",
    "--limit",
    limit,
    ...ownerArgs(owner),
  ];
  if (query) ghArgs.push("--query", query);

  const result = await ghJson<ProjectItemListResult>(ghArgs);
  const items = result.items ?? [];
  const isEmpty = items.length === 0;

  const countLine = formatCountLine({
    count: items.length,
    limit: Number(limit),
    totalCount: result.totalCount,
  });

  return renderOutput([
    countLine,
    renderProjectItems(items),
    renderHelp(
      getSuggestions({
        domain: "project",
        action: "item-list",
        id: num,
        isEmpty,
        owner,
      }),
    ),
  ]);
}

async function projectFieldList(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const owner = resolveOwner(args, ctx);
  const num = takeNumber(args, "project");
  const limit = takeFlag(args, "--limit") ?? "30";

  const ghArgs = [
    "project",
    "field-list",
    String(num),
    "--format",
    "json",
    "--limit",
    limit,
    ...ownerArgs(owner),
  ];

  const result = await ghJson<ProjectFieldListResult>(ghArgs);
  const fields = result.fields ?? [];
  const isEmpty = fields.length === 0;

  const countLine = formatCountLine({
    count: fields.length,
    limit: Number(limit),
    totalCount: result.totalCount,
  });

  return renderOutput([
    countLine,
    renderProjectFields(fields),
    renderHelp(
      getSuggestions({
        domain: "project",
        action: "field-list",
        id: num,
        isEmpty,
        owner,
      }),
    ),
  ]);
}

async function projectItemAdd(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const owner = resolveOwner(args, ctx);
  const num = takeNumber(args, "project");
  const url = takeFlag(args, "--url");
  if (!url)
    throw new AxiError(
      "--url is required: gh-axi project item-add <number> --url <issue-or-pr-url>",
      "VALIDATION_ERROR",
    );

  const ghArgs = [
    "project",
    "item-add",
    String(num),
    "--url",
    url,
    "--format",
    "json",
    ...ownerArgs(owner),
  ];

  const item = await ghJson<ProjectItem>(ghArgs);
  return renderOutput([
    renderDetail(
      "added",
      { id: item.id ?? null, title: item.title ?? null, status: "ok" },
      [field("id"), field("title"), field("status")],
    ),
    renderHelp(
      getSuggestions({ domain: "project", action: "item-add", id: num, owner }),
    ),
  ]);
}

async function projectItemCreate(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const owner = resolveOwner(args, ctx);
  const num = takeNumber(args, "project");
  const title = takeFlag(args, "--title");
  if (!title)
    throw new AxiError(
      '--title is required: gh-axi project item-create <number> --title "..."',
      "VALIDATION_ERROR",
    );
  const body = takeBody(args);

  const ghArgs = [
    "project",
    "item-create",
    String(num),
    "--title",
    title,
    "--format",
    "json",
    ...ownerArgs(owner),
  ];
  if (body !== undefined) ghArgs.push("--body", body);

  const item = await ghJson<ProjectItem>(ghArgs);
  return renderOutput([
    renderDetail(
      "created",
      { id: item.id ?? null, title: item.title ?? title, status: "ok" },
      [field("id"), field("title"), field("status")],
    ),
    renderHelp(
      getSuggestions({
        domain: "project",
        action: "item-create",
        id: num,
        owner,
      }),
    ),
  ]);
}

async function projectItemEdit(args: string[]): Promise<string> {
  const id = takeFlag(args, "--id");
  if (!id)
    throw new AxiError(
      "--id is required: gh-axi project item-edit --id <item-id> [--field-id <id> --project-id <id> --text \"...\"]",
      "VALIDATION_ERROR",
    );
  const projectId = takeFlag(args, "--project-id");
  const fieldId = takeFlag(args, "--field-id");
  const text = takeFlag(args, "--text");
  const numberValue = takeFlag(args, "--number");
  const date = takeFlag(args, "--date");
  const singleSelectOptionId = takeFlag(args, "--single-select-option-id");
  const iterationId = takeFlag(args, "--iteration-id");
  const title = takeFlag(args, "--title");
  const body = takeBody(args);
  const clear = takeBoolFlag(args, "--clear");

  const ghArgs = ["project", "item-edit", "--id", id, "--format", "json"];
  if (projectId) ghArgs.push("--project-id", projectId);
  if (fieldId) ghArgs.push("--field-id", fieldId);
  if (text !== undefined) ghArgs.push("--text", text);
  if (numberValue !== undefined) ghArgs.push("--number", numberValue);
  if (date) ghArgs.push("--date", date);
  if (singleSelectOptionId)
    ghArgs.push("--single-select-option-id", singleSelectOptionId);
  if (iterationId) ghArgs.push("--iteration-id", iterationId);
  if (title) ghArgs.push("--title", title);
  if (body !== undefined) ghArgs.push("--body", body);
  if (clear) ghArgs.push("--clear");

  const item = await ghJson<ProjectItem>(ghArgs);
  return renderOutput([
    renderDetail("edited", { id: item.id ?? id, status: "ok" }, [
      field("id"),
      field("status"),
    ]),
    renderHelp(
      getSuggestions({ domain: "project", action: "item-edit", id }),
    ),
  ]);
}

async function projectItemArchive(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const owner = resolveOwner(args, ctx);
  const num = takeNumber(args, "project");
  const id = takeFlag(args, "--id");
  if (!id)
    throw new AxiError(
      "--id is required: gh-axi project item-archive <number> --id <item-id>",
      "VALIDATION_ERROR",
    );
  const undo = takeBoolFlag(args, "--undo");

  const ghArgs = [
    "project",
    "item-archive",
    String(num),
    "--id",
    id,
    "--format",
    "json",
    ...ownerArgs(owner),
  ];
  if (undo) ghArgs.push("--undo");

  const item = await ghJson<ProjectItem>(ghArgs);
  return renderOutput([
    renderDetail(
      undo ? "unarchived" : "archived",
      { id: item.id ?? id, status: "ok" },
      [field("id"), field("status")],
    ),
    renderHelp(
      getSuggestions({
        domain: "project",
        action: "item-archive",
        id: num,
        owner,
      }),
    ),
  ]);
}

async function projectItemDelete(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const owner = resolveOwner(args, ctx);
  const num = takeNumber(args, "project");
  const id = takeFlag(args, "--id");
  if (!id)
    throw new AxiError(
      "--id is required: gh-axi project item-delete <number> --id <item-id>",
      "VALIDATION_ERROR",
    );

  const ghArgs = [
    "project",
    "item-delete",
    String(num),
    "--id",
    id,
    "--format",
    "json",
    ...ownerArgs(owner),
  ];

  const item = await ghJson<ProjectItem>(ghArgs);
  return renderOutput([
    renderDetail("deleted", { id: item.id ?? id, status: "ok" }, [
      field("id"),
      field("status"),
    ]),
    renderHelp(
      getSuggestions({
        domain: "project",
        action: "item-delete",
        id: num,
        owner,
      }),
    ),
  ]);
}

async function projectCreate(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const owner = resolveOwner(args, ctx);
  const title = takeFlag(args, "--title");
  if (!title)
    throw new AxiError(
      '--title is required: gh-axi project create --title "..."',
      "VALIDATION_ERROR",
    );

  const ghArgs = [
    "project",
    "create",
    "--title",
    title,
    "--format",
    "json",
    ...ownerArgs(owner),
  ];

  const project = await ghJson<ProjectRecord>(ghArgs);
  return renderOutput([
    renderDetail(
      "created",
      { number: project.number ?? null, url: project.url ?? null },
      [field("number"), field("url")],
    ),
    renderHelp(
      getSuggestions({
        domain: "project",
        action: "create",
        id: project.number,
        owner,
      }),
    ),
  ]);
}

async function projectEdit(args: string[], ctx?: RepoContext): Promise<string> {
  const owner = resolveOwner(args, ctx);
  const num = takeNumber(args, "project");
  const title = takeFlag(args, "--title");
  const description = takeFlag(args, "--description");
  const readme = takeFlag(args, "--readme");
  const visibility = takeFlag(args, "--visibility");

  const ghArgs = [
    "project",
    "edit",
    String(num),
    "--format",
    "json",
    ...ownerArgs(owner),
  ];
  if (title) ghArgs.push("--title", title);
  if (description !== undefined) ghArgs.push("--description", description);
  if (readme !== undefined) ghArgs.push("--readme", readme);
  if (visibility) ghArgs.push("--visibility", visibility);

  await ghJson<ProjectRecord>(ghArgs);
  return renderOutput([
    renderDetail("edited", { number: num, status: "ok" }, [
      field("number"),
      field("status"),
    ]),
    renderHelp(
      getSuggestions({ domain: "project", action: "edit", id: num, owner }),
    ),
  ]);
}

async function projectClose(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const owner = resolveOwner(args, ctx);
  const num = takeNumber(args, "project");
  const undo = takeBoolFlag(args, "--undo");

  // Idempotent: check current state before mutating.
  const current = await ghJson<ProjectRecord>([
    "project",
    "view",
    String(num),
    "--format",
    "json",
    ...ownerArgs(owner),
  ]);
  const alreadyDesired = undo ? current.closed === false : current.closed === true;
  if (alreadyDesired) {
    return renderOutput([
      renderDetail(
        "project",
        { number: num, state: undo ? "open" : "closed", already: true },
        [field("number"), field("state"), field("already")],
      ),
      renderHelp(
        getSuggestions({ domain: "project", action: "close", id: num, owner }),
      ),
    ]);
  }

  const ghArgs = [
    "project",
    "close",
    String(num),
    "--format",
    "json",
    ...ownerArgs(owner),
  ];
  if (undo) ghArgs.push("--undo");

  await ghJson<ProjectRecord>(ghArgs);
  return renderOutput([
    renderDetail(
      undo ? "reopened" : "closed",
      { number: num, status: "ok" },
      [field("number"), field("status")],
    ),
    renderHelp(
      getSuggestions({ domain: "project", action: "close", id: num, owner }),
    ),
  ]);
}

async function projectCopy(args: string[], ctx?: RepoContext): Promise<string> {
  const num = takeNumber(args, "project");
  const sourceOwner = takeFlag(args, "--source-owner") ?? ctx?.owner;
  const targetOwner = takeFlag(args, "--target-owner");
  if (!targetOwner)
    throw new AxiError(
      "--target-owner is required: gh-axi project copy <number> --target-owner <login> --title \"...\"",
      "VALIDATION_ERROR",
    );
  const title = takeFlag(args, "--title");
  if (!title)
    throw new AxiError(
      '--title is required: gh-axi project copy <number> --target-owner <login> --title "..."',
      "VALIDATION_ERROR",
    );
  const drafts = takeBoolFlag(args, "--drafts");

  const ghArgs = [
    "project",
    "copy",
    String(num),
    "--target-owner",
    targetOwner,
    "--title",
    title,
    "--format",
    "json",
  ];
  if (sourceOwner) ghArgs.push("--source-owner", sourceOwner);
  if (drafts) ghArgs.push("--drafts");

  const project = await ghJson<ProjectRecord>(ghArgs);
  return renderOutput([
    renderDetail(
      "copied",
      { number: project.number ?? null, url: project.url ?? null },
      [field("number"), field("url")],
    ),
    renderHelp(
      getSuggestions({
        domain: "project",
        action: "copy",
        id: project.number,
        owner: targetOwner,
      }),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function projectCommand(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const sub = args[0];
  const rest = args.slice(1);

  switch (sub) {
    case "list":
      return projectList(rest, ctx);
    case "view":
      return projectView(rest, ctx);
    case "item-list":
      return projectItemList(rest, ctx);
    case "field-list":
      return projectFieldList(rest, ctx);
    case "item-add":
      return projectItemAdd(rest, ctx);
    case "item-create":
      return projectItemCreate(rest, ctx);
    case "item-edit":
      return projectItemEdit(rest);
    case "item-archive":
      return projectItemArchive(rest, ctx);
    case "item-delete":
      return projectItemDelete(rest, ctx);
    case "create":
      return projectCreate(rest, ctx);
    case "edit":
      return projectEdit(rest, ctx);
    case "close":
      return projectClose(rest, ctx);
    case "copy":
      return projectCopy(rest, ctx);
    case "--help":
    case "-h":
    case "help":
    case undefined:
      return PROJECT_HELP;
    default:
      return renderError(
        `Unknown project subcommand: ${sub}`,
        "VALIDATION_ERROR",
        ["Run `gh-axi project --help` to see available subcommands"],
      );
  }
}
