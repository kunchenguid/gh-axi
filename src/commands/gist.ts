import { encode } from "@toon-format/toon";
import { ghJson, ghExec, ghExecWithStdin } from "../gh.js";
import { AxiError } from "../errors.js";
import { hasFlag, takeFlag, takeBoolFlag, takeAllFlags } from "../args.js";
import {
  field,
  custom,
  relativeTime,
  pluck,
  renderList,
  renderDetail,
  renderHelp,
  renderOutput,
  renderError,
  type FieldDef,
} from "../toon.js";
import { formatCountLine } from "../format.js";
import { getSuggestions } from "../suggestions.js";
import { parseFields, type ExtraFieldSpec } from "../fields.js";
import { isStdinTTY, readStdin } from "../stdin.js";
import { gistIdFromSelector } from "../gistSelector.js";

export const GIST_HELP = `usage: gh-axi gist <subcommand> [flags]
subcommands[7]:
  list, view <id|url>, edit <id|url>, rename <id|url> <old> <new>, create, delete <id|url>, clone <id|url>
flags{list}:
  --limit <n> (default 100), --public, --secret, --fields <field,...>
flags{view}:
  --files (file names only), -f/--filename <name> (single file), --full (no truncation), -r/--raw (no-op), -w/--web (rejected)
flags{edit}:
  --filename/-f <name> (replace from piped stdin), --add/-a <path> (from disk) or --add/-a <name> - (from piped stdin), --remove/-r <name>, --desc/-d <text>
flags{create}:
  --public (required, mutually exclusive with --secret)
  --secret (required, mutually exclusive with --public)
  --file <path> (repeatable), --filename <name> (for piped content)
  -d/--desc <text>
examples:
  gh-axi gist list
  gh-axi gist list --public --limit 20
  gh-axi gist list --fields url,owner,created
  gh-axi gist view 5b0e0062eb8e9654adad7bb1d81cc75f
  gh-axi gist view https://gist.github.com/octocat/5b0e0062eb8e9654adad7bb1d81cc75f
  gh-axi gist view 5b0e0062eb8e9654adad7bb1d81cc75f --files
  echo 'new content' | gh-axi gist edit <id|url> --filename notes.md
  echo 'new file' | gh-axi gist edit <id|url> --add new.txt -
  gh-axi gist edit <id|url> --add ./local.txt
  gh-axi gist edit <id|url> --remove old-file.txt --desc "updated description"
  gh-axi gist rename <id|url> old.txt new.txt
  gh-axi gist create notes.md --public --desc "My notes"
  gh-axi gist create --file a.py --file b.py --secret
  echo "content" | gh-axi gist create --filename hello.txt --public
  gh-axi gist delete <id|url>
  gh-axi gist clone <id|url>`;

/** Maximum items per /gists page. Also the per_page ceiling for this endpoint. */
const PAGE_SIZE = 100;

/** Always-present fields in list output (AXI P2: 3–4 fields). */
const defaultSchema: FieldDef[] = [
  field("id"),
  field("description"),
  custom(
    "files",
    (item) =>
      Object.keys((item["files"] as Record<string, unknown>) ?? {}).length,
  ),
  custom("visibility", (item) =>
    item["public"] === true ? "public" : "secret",
  ),
];

/** Extra fields unlocked via --fields. */
const EXTRA_FIELDS: Record<string, ExtraFieldSpec> = {
  created: {
    jsonKey: "created_at",
    def: relativeTime("created_at", "created"),
  },
  updated: {
    jsonKey: "updated_at",
    def: relativeTime("updated_at", "updated"),
  },
  url: { jsonKey: "html_url", def: field("html_url", "url") },
  comments: { jsonKey: "comments", def: field("comments") },
  owner: { jsonKey: "owner", def: pluck("owner", "login", "owner") },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GistFile {
  filename: string;
  type?: string;
  language?: string;
  size: number;
  content?: string;
  truncated?: boolean;
  raw_url?: string;
}

interface GistDetail {
  id: string;
  description: string | null;
  public: boolean;
  owner: { login: string } | null;
  files: Record<string, GistFile>;
  comments: number;
  created_at: string;
  updated_at: string;
  html_url: string;
}

// ---------------------------------------------------------------------------
// Shared guards
// ---------------------------------------------------------------------------

/** A token's flag name, ignoring any `=value` suffix. */
function flagName(token: string): string {
  return token.split("=")[0];
}

/**
 * Reject every leftover token that looks like a flag but is not on the allowed
 * list. Callers must consume their value flags first, so anything remaining is
 * either an allowed bare token or a typo that would otherwise silently degrade
 * the result at exit 0 (`--ful` ignored, `--dry-run` ignored before a delete).
 * Single-dash tokens count too: gh shorthands must never reach a positional slot.
 *
 * Matching is exact, never normalized across `=`. Allowed tokens are read back
 * with hasFlag/includes, which only see the bare form — so `--full=true` must
 * be rejected here rather than accepted and then silently ignored.
 */
function rejectUnknownFlags(
  tokens: string[],
  allowed: readonly string[],
): void {
  const unknown = tokens.filter(
    (a) => a.startsWith("-") && !allowed.includes(a),
  );
  if (unknown.length > 0) {
    throw new AxiError(
      `Unknown flag(s): ${unknown.join(", ")}`,
      "VALIDATION_ERROR",
    );
  }
}

/**
 * Read piped stdin, rejecting a zero-length read the way resolveValue does.
 * isStdinTTY() never fires in agent contexts, so an empty read is the only
 * signal that nothing was actually piped — issuing the gh write anyway would
 * replace the target file's content with nothing.
 */
async function readRequiredStdin(example: string): Promise<string> {
  const content = await readStdin();
  if (content.length === 0) {
    throw new AxiError(
      "no content received on stdin; nothing was piped",
      "VALIDATION_ERROR",
      [example],
    );
  }
  return content;
}

// ---------------------------------------------------------------------------
// Content truncation (gist-specific: no prose cleanups)
// ---------------------------------------------------------------------------

/** Maximum characters shown per file in the default (non-full) view. */
const CONTENT_MAX_LEN = 1500;

/**
 * Raw head-slice truncation for gist file content.
 *
 * Unlike truncateBody, this helper applies NO prose cleanups. Gist content
 * is often source code or diffs where cleanup transforms (collapsing lines
 * starting with `>`, stripping URLs) would corrupt the content.
 * Footer is appended only when content is actually truncated (AXI P3).
 */
function truncateGistContent(
  content: string,
  maxLen: number,
  full: boolean,
): string {
  if (full || content.length <= maxLen) return content;
  return (
    content.slice(0, maxLen) +
    `\n... (truncated, ${content.length} chars total - use --full)`
  );
}

// ---------------------------------------------------------------------------
// View schemas
// ---------------------------------------------------------------------------

const gistMetaSchema: FieldDef[] = [
  field("id"),
  field("description"),
  custom("visibility", (item: GistDetail) =>
    item.public === true ? "public" : "secret",
  ),
  custom("files", (item: GistDetail) => Object.keys(item.files ?? {}).length),
  relativeTime("created_at", "created"),
  relativeTime("updated_at", "updated"),
  field("comments"),
  field("html_url", "url"),
  pluck("owner", "login", "owner"),
];

/**
 * GET /gists/<id> caps each file's `content` at 1 MB and sets `truncated: true`
 * (files over 10 MB carry no content at all). --full cannot undo that server-side
 * cap, so the note is appended regardless of --full and points at raw_url.
 */
function apiTruncationNote(file: GistFile): string {
  const source = file.raw_url
    ? ` - fetch the full file from ${file.raw_url}`
    : "";
  return `\n... (truncated by the GitHub API at 1MB${source})`;
}

function makeFileSchema(full: boolean): FieldDef[] {
  return [
    field("filename"),
    custom("size", (item: GistFile) => `${item.size} bytes`),
    custom("content", (item: GistFile) => {
      const raw = typeof item.content === "string" ? item.content : "";
      const shown = truncateGistContent(raw, CONTENT_MAX_LEN, full);
      return item.truncated === true ? shown + apiTruncationNote(item) : shown;
    }),
  ];
}

// ---------------------------------------------------------------------------
// View handler
// ---------------------------------------------------------------------------

// viewGist deliberately has no ctx parameter — gist is user-scoped.
async function viewGist(args: string[]): Promise<string> {
  // Reject -w/--web up-front before consuming any other args (AXI P6).
  if (args.some((a) => flagName(a) === "-w" || flagName(a) === "--web")) {
    throw new AxiError(
      "-w/--web is not supported: opening a browser is a no-op in agent contexts",
      "VALIDATION_ERROR",
    );
  }

  const full = hasFlag(args, "--full");
  const filesOnly = hasFlag(args, "--files");
  // takeFlag mutates args; consume -f before --filename to avoid double-take.
  const filenameShort = takeFlag(args, "-f");
  const filenameLong = takeFlag(args, "--filename");
  const filenameArg = filenameShort ?? filenameLong;

  // Every value flag is consumed above, so any remaining flag-shaped token must
  // be a boolean view flag. -r/--raw is documented as a no-op (output is always
  // raw text) and is whitelisted purely to keep that contract.
  rejectUnknownFlags(args.slice(1), ["--files", "--full", "-r", "--raw"]);

  // The selector is the sole remaining positional (args[0] is "view"; all
  // value flags were consumed above). Order-insensitive: `gist view --full <id>`
  // must work as well as `gist view <id> --full`.
  const positionals = args.slice(1).filter((a) => !a.startsWith("-"));
  const selector = positionals[0];
  if (!selector) {
    throw new AxiError(
      "gist view requires a gist id or URL",
      "VALIDATION_ERROR",
      ["Usage: gh-axi gist view <id|url>"],
    );
  }
  if (positionals.length > 1) {
    throw new AxiError(
      `Unexpected argument: ${positionals[1]}`,
      "VALIDATION_ERROR",
    );
  }

  // Validate + extract bare id (throws VALIDATION_ERROR on bad input/host).
  const id = gistIdFromSelector(selector);

  // No ctx forwarded — gist is user-scoped; gh.ts#buildArgs would append
  // --repo for flag/env-sourced contexts and gh api has no --repo flag.
  const data = await ghJson<GistDetail>(["api", `/gists/${id}`]);
  const fileList = Object.values(data.files ?? {});

  const suggestions = getSuggestions({ domain: "gist", action: "view", id });

  if (filesOnly) {
    return renderOutput([
      renderList("files", fileList, [field("filename")]),
      renderHelp(suggestions),
    ]);
  }

  if (filenameArg !== undefined) {
    const file = (data.files ?? {})[filenameArg];
    if (!file) {
      const available = Object.keys(data.files ?? {}).join(", ");
      throw new AxiError(
        `File "${filenameArg}" not found in gist ${id}. Available: ${available || "(none)"}`,
        "VALIDATION_ERROR",
      );
    }
    return renderOutput([
      renderList("files", [file], makeFileSchema(full)),
      renderHelp(suggestions),
    ]);
  }

  // Default: metadata block + all files with (possibly truncated) content.
  return renderOutput([
    renderDetail(
      "gist",
      data as unknown as Record<string, unknown>,
      gistMetaSchema,
    ),
    renderList("files", fileList, makeFileSchema(full)),
    renderHelp(suggestions),
  ]);
}

// listGists deliberately has no ctx parameter. gist is user-scoped and
// gh api /gists has no --repo flag; the guard is enforced structurally.
// See AGENTS.md "User-scoped commands" section.
async function listGists(args: string[]): Promise<string> {
  const wantPublic = takeBoolFlag(args, "--public");
  const wantSecret = takeBoolFlag(args, "--secret");

  // Fail loudly — passing both is undefined behaviour, not a degraded result.
  if (wantPublic && wantSecret) {
    throw new AxiError(
      "--public and --secret are mutually exclusive",
      "VALIDATION_ERROR",
    );
  }

  // Let parseFields throw AxiError on unknown fields so the process exits
  // non-zero — matching every sibling command family (issue.ts:226, run.ts:207).
  const fieldsArg = takeFlag(args, "--fields");
  const { extraDefs } = parseFields(fieldsArg, EXTRA_FIELDS);

  // Validate --limit before use; parseInt("abc") = NaN and slice(0, NaN) = []
  // giving a silent empty result at exit 0, which is actively wrong.
  const limitArg = takeFlag(args, "--limit");

  // Both value flags are consumed above, so nothing flag-shaped may remain:
  // `--limitt 5` must fail loudly instead of silently returning 100 rows.
  rejectUnknownFlags(args.slice(1), []);

  let limit: number;
  if (limitArg !== undefined) {
    const n = parseInt(limitArg, 10);
    if (isNaN(n) || n < 1) {
      throw new AxiError(
        `--limit must be a positive integer, got: ${limitArg}`,
        "VALIDATION_ERROR",
      );
    }
    limit = n;
  } else {
    limit = PAGE_SIZE;
  }

  // --limit caps the *displayed* rows after filtering, not the fetch size.
  // When a visibility filter is active we must fetch ALL pages regardless of
  // limit — the API has no visibility filter, so we can only count matching
  // gists after receiving them. Without pagination, a --secret --limit 50 on
  // an account with 94 secret gists (and some public ones interspersed) would
  // silently stop at the first 100 API results and under-report.
  const filtering = wantPublic || wantSecret;
  const paginate = limit > PAGE_SIZE || filtering;
  const perPage = filtering ? PAGE_SIZE : Math.min(limit, PAGE_SIZE);

  const apiArgs: string[] = ["api", `/gists?per_page=${perPage}`];
  if (paginate) {
    // gh merges paginated array responses into a single valid JSON array
    // (verified on gh 2.86.0 — no concatenation issue for array endpoints).
    apiArgs.push("--paginate");
  }

  // No ctx forwarded — gist is user-scoped; gh.ts#buildArgs would append
  // --repo <nwo> for flag/env-sourced contexts and gh api has no --repo.
  const gists = await ghJson<Record<string, unknown>[]>(apiArgs);

  // Client-side visibility filter (the /gists endpoint has no visibility param).
  const filtered = wantPublic
    ? gists.filter((g) => g["public"] === true)
    : wantSecret
      ? gists.filter((g) => g["public"] !== true)
      : gists;

  // Client-side display cap applied after filtering.
  const displayed = filtered.slice(0, limit);

  const isEmpty = displayed.length === 0;
  const schema = [...defaultSchema, ...extraDefs];
  const countLine = formatCountLine({ count: displayed.length, limit });

  const suggestions = getSuggestions({
    domain: "gist",
    action: "list",
    isEmpty,
  });
  return renderOutput([
    countLine,
    renderList("gists", displayed, schema),
    renderHelp(suggestions),
  ]);
}

// deleteGist has no ctx parameter — gist is user-scoped.
// gh gist delete refuses to run non-interactively without --yes;
// always pass it so this command never prompts.
async function deleteGist(args: string[]): Promise<string> {
  // delete takes no flags. Reject them before resolving the selector so a
  // misspelled guard flag (`--dry-run`) can never be silently dropped.
  rejectUnknownFlags(args.slice(1), []);

  const positionals = args.filter((a) => !a.startsWith("-"));
  const selector = positionals[1]; // positionals[0] == "delete"
  const extra = positionals[2];

  if (!selector)
    throw new AxiError(
      "Gist is required: gh-axi gist delete <id|url>",
      "VALIDATION_ERROR",
    );
  if (extra)
    throw new AxiError(`Unexpected argument: ${extra}`, "VALIDATION_ERROR");

  await ghExec(["gist", "delete", selector, "--yes"]);
  const suggestions = getSuggestions({ domain: "gist", action: "delete" });
  return renderOutput([encode({ deleted: selector }), renderHelp(suggestions)]);
}

// cloneGist has no ctx parameter — gist is user-scoped.
// Mirrors cloneRepo exactly: take the selector, shell out, report ok.
// No target-directory or git-flags passthrough — matches repo clone restraint.
async function cloneGist(args: string[]): Promise<string> {
  // clone takes no flags — same rejection as delete, so no git/gh shorthand
  // slips through as the selector.
  rejectUnknownFlags(args.slice(1), []);

  const positionals = args.filter((a) => !a.startsWith("-"));
  const selector = positionals[1]; // positionals[0] == "clone"
  const extra = positionals[2];

  if (!selector)
    throw new AxiError(
      "Gist is required: gh-axi gist clone <id|url>",
      "VALIDATION_ERROR",
    );
  if (extra)
    throw new AxiError(`Unexpected argument: ${extra}`, "VALIDATION_ERROR");

  await ghExec(["gist", "clone", selector]);
  const suggestions = getSuggestions({ domain: "gist", action: "clone" });
  return renderOutput([
    encode({ clone: "ok", gist: selector }),
    renderHelp(suggestions),
  ]);
}

// createGist deliberately has no ctx parameter. gist is user-scoped and
// gh gist create has no --repo flag; the guard is enforced structurally.
// See AGENTS.md "User-scoped commands" section.
async function createGist(args: string[]): Promise<string> {
  // Value flags are consumed before the visibility booleans so a description
  // like `--desc --secret=true` is not misread as a boolean value form.
  // Description: -d and --desc are aliases; take both.
  const descShort = takeFlag(args, "-d");
  const descLong = takeFlag(args, "--desc");
  const desc = descShort ?? descLong;

  // Input form flags. takeAllFlags throws VALIDATION_ERROR on dangling / blank.
  const filename = takeFlag(args, "--filename");
  const fileFlags = takeAllFlags(args, "--file");

  // Visibility: required and mutually exclusive — checked before any gh work.
  const wantPublic = takeBoolFlag(args, "--public");
  const wantSecret = takeBoolFlag(args, "--secret");

  if (wantPublic && wantSecret) {
    throw new AxiError(
      "--public and --secret are mutually exclusive",
      "VALIDATION_ERROR",
    );
  }
  if (!wantPublic && !wantSecret) {
    throw new AxiError(
      "gist create requires --public or --secret; neither was given\n" +
        "A secret gist is unlisted (anyone with the URL can read it), not private.",
      "VALIDATION_ERROR",
    );
  }

  // After consuming all known flags, args[0] === "create" (subcommand name).
  // Anything at index 1+ is either a positional file path or an unknown flag.
  // Use startsWith("-") — not "--" — so single-dash gh shorthands (e.g. -p for
  // --public, -w for --web, -f for --filename) are rejected rather than
  // forwarded as file paths. -p is especially dangerous: it reaches gh as the
  // --public flag, creating a public gist while the wrapper reports secret.
  const remaining = args.slice(1);
  rejectUnknownFlags(remaining, []);
  const positionals = remaining.filter((a) => !a.startsWith("-"));

  // Mixing the two file-on-disk input forms is a hard error.
  if (positionals.length > 0 && fileFlags.length > 0) {
    throw new AxiError(
      "Cannot mix positional paths with --file; use one form: " +
        "either `gist create a.py b.py` or `gist create --file a.py --file b.py`",
      "VALIDATION_ERROR",
    );
  }

  // Mixing file-on-disk with stdin/--filename is also a hard error.
  const hasFileArgs = positionals.length > 0 || fileFlags.length > 0;
  if (hasFileArgs && filename !== undefined) {
    throw new AxiError(
      "Cannot mix file paths with --filename; use one input form",
      "VALIDATION_ERROR",
    );
  }

  // At least one input source must be provided.
  if (!hasFileArgs && filename === undefined) {
    throw new AxiError(
      "gist create requires at least one file: pass positional path(s), " +
        "--file <path>, or pipe content with --filename <name>",
      "VALIDATION_ERROR",
    );
  }

  const visibility = wantPublic ? "public" : "secret";

  // Build the base gh argv. Only --public changes default visibility (gh
  // defaults to secret, so we never pass --secret to gh).
  const ghArgs = ["gist", "create"];
  if (wantPublic) ghArgs.push("--public");
  if (desc) ghArgs.push("-d", desc);

  let stdout: string;

  if (filename !== undefined) {
    // Stdin form: pipe content to gh with --filename.
    // Any condition that would make gh prompt or open $EDITOR must be caught
    // before invoking gh — an agent cannot answer a prompt.
    if (isStdinTTY()) {
      throw new AxiError(
        "--filename requires piped content on stdin; no pipe was detected",
        "VALIDATION_ERROR",
        [`echo 'content' | gh-axi gist create --filename <name> --public`],
      );
    }
    const content = await readRequiredStdin(
      `echo 'content' | gh-axi gist create --filename <name> --public`,
    );
    ghArgs.push("--filename", filename);
    // No ctx — gist is user-scoped; buildArgs must not append --repo.
    stdout = await ghExecWithStdin(ghArgs, content);
  } else {
    // File form: positionals take precedence; fileFlags are translated to positionals.
    const paths = positionals.length > 0 ? positionals : fileFlags;
    ghArgs.push(...paths);
    // No ctx — gist is user-scoped; buildArgs must not append --repo.
    stdout = await ghExec(ghArgs);
  }

  // gh gist create prints only the HTML URL to stdout (status messages go to
  // stderr). Parse the id from the URL's last path segment, matching the
  // pattern used by pr create's URL → number extraction.
  const url = stdout.trim().split("\n").pop()?.trim() ?? "";
  const id = url.split("/").pop() ?? "";

  const navSuggestions = getSuggestions({
    domain: "gist",
    action: "create",
    id,
  });
  const helpLines: string[] = [];
  // Secret gists are unlisted, not private. Surface this before navigation hints
  // so the agent sees the warning even if it stops reading after the first line.
  if (visibility === "secret") {
    helpLines.push(
      "a secret gist is unlisted, not private — anyone with the URL can read it",
    );
  }
  helpLines.push(...navSuggestions);

  return renderOutput([
    renderDetail("created", { id, url, visibility }, [
      field("id"),
      field("url"),
      field("visibility"),
    ]),
    renderHelp(helpLines),
  ]);
}

// editGist has no ctx parameter — see gistCommand note below.
async function editGist(args: string[]): Promise<string> {
  // Consume every value flag first (takeFlag mutates), so the selector can be
  // located order-insensitively among whatever positionals remain. args[0] is
  // "edit". `??` short-circuits: a present long flag skips the short alias.
  const rest = args.slice(1);
  const filenameFlag = takeFlag(rest, "--filename") ?? takeFlag(rest, "-f");
  const addFlag = takeFlag(rest, "--add") ?? takeFlag(rest, "-a");
  const removeFlag = takeFlag(rest, "--remove") ?? takeFlag(rest, "-r");
  const descFlag = takeFlag(rest, "--desc") ?? takeFlag(rest, "-d");

  // Every value flag is consumed above. Anything flag-shaped that survives is a
  // typo which the positional filter below would otherwise drop silently —
  // `--remove old.txt --dry-run` must not quietly remove the file. The lone "-"
  // stdin sentinel is a positional, and each alias stays allowed so a duplicate
  // pair (`--remove x -r y`) still falls through to the surplus-positional error.
  rejectUnknownFlags(rest, [
    "-",
    "--filename",
    "-f",
    "--add",
    "-a",
    "--remove",
    "-r",
    "--desc",
    "-d",
  ]);

  // A lone "-" is the explicit "read content from stdin" sentinel (gh's own
  // convention). It is the ONLY stdin signal — never inferred from TTY-ness,
  // because this tool always runs with a non-TTY stdin in agent contexts, so
  // `!isStdinTTY()` would misclassify every invocation as "content piped".
  const wantsStdin = rest.includes("-");

  // The selector is the sole remaining positional (anything that is neither a
  // flag nor the "-" sentinel). Order-insensitive, unlike the old args[1].
  const positionals = rest.filter((a) => !a.startsWith("-"));
  const id = positionals[0];
  if (!id) {
    throw new AxiError(
      "Gist ID or URL is required: gh-axi gist edit <id|url> [flags]",
      "VALIDATION_ERROR",
    );
  }
  if (positionals.length > 1) {
    throw new AxiError(
      `Unexpected argument: ${positionals[1]}`,
      "VALIDATION_ERROR",
    );
  }

  // Reject mutually exclusive file operations in a single call.
  const fileOpCount = [filenameFlag, addFlag, removeFlag].filter(
    (v): v is string => v !== undefined,
  ).length;
  if (fileOpCount > 1) {
    throw new AxiError(
      "--filename, --add, and --remove are mutually exclusive; pass only one per invocation",
      "VALIDATION_ERROR",
    );
  }

  // Guard: nothing to edit — gh with no flags would open $EDITOR.
  if (
    filenameFlag === undefined &&
    addFlag === undefined &&
    removeFlag === undefined &&
    descFlag === undefined
  ) {
    throw new AxiError(
      "nothing to edit; pass --filename <name> with piped content, --add <path|name>, --remove <name>, or --desc <text>",
      "VALIDATION_ERROR",
    );
  }

  // Guard: the stdin sentinel needs a file selector, else gh prompts which
  // file to write ("unsure what file to edit").
  if (wantsStdin && filenameFlag === undefined && addFlag === undefined) {
    throw new AxiError(
      "stdin content (-) requires --filename <name> or --add <name> to identify the target file",
      "VALIDATION_ERROR",
      [
        "Replace a file: echo 'content' | gh-axi gist edit <id|url> --filename <name>",
        "Add a new file: echo 'content' | gh-axi gist edit <id|url> --add <name> -",
      ],
    );
  }

  if (filenameFlag !== undefined) {
    // Replace (or create) a file from piped stdin. --filename's content always
    // comes from stdin, so fail fast on a TTY (we must never block reading it).
    if (isStdinTTY()) {
      throw new AxiError(
        "--filename requires content piped via stdin",
        "VALIDATION_ERROR",
        [
          "Example: echo 'content' | gh-axi gist edit <id|url> --filename <name>",
        ],
      );
    }
    // The `-` positional tells gh to read content from stdin; `--filename`
    // names the target file in the gist. Without `-`, gh ignores piped bytes
    // and opens $EDITOR instead — verified against a live gist.
    const ghArgs = ["gist", "edit", id, "-", "--filename", filenameFlag];
    if (descFlag !== undefined) ghArgs.push("--desc", descFlag);
    const content = await readRequiredStdin(
      "Example: echo 'content' | gh-axi gist edit <id|url> --filename <name>",
    );
    await ghExecWithStdin(ghArgs, content);
  } else if (addFlag !== undefined && wantsStdin) {
    // Add a brand-new file from piped stdin, signalled by the explicit `-`.
    // `--add <name>` names the new file; the trailing `-` is the content
    // source (stdin), matching `gh gist edit <id> --add <name> -`.
    if (isStdinTTY()) {
      throw new AxiError(
        "--add with the stdin sentinel (-) requires content piped via stdin",
        "VALIDATION_ERROR",
        ["Example: echo 'content' | gh-axi gist edit <id|url> --add <name> -"],
      );
    }
    const ghArgs = ["gist", "edit", id, "--add", addFlag, "-"];
    if (descFlag !== undefined) ghArgs.push("--desc", descFlag);
    const content = await readRequiredStdin(
      "Example: echo 'content' | gh-axi gist edit <id|url> --add <name> -",
    );
    await ghExecWithStdin(ghArgs, content);
  } else if (
    descFlag !== undefined &&
    addFlag === undefined &&
    removeFlag === undefined
  ) {
    // Description-only update.
    // `gh gist edit <id> --desc <text>` with no file selector still enters
    // the content-edit loop: on a multi-file gist it errors "unsure what file
    // to edit"; on a single-file gist it relies on $EDITOR being a no-op
    // (fragile in CI). Route through the REST API instead — metadata writes
    // have no binary-content concern so the API path is safe here.
    const gistId = gistIdFromSelector(id);
    await ghExec([
      "api",
      "-X",
      "PATCH",
      `/gists/${gistId}`,
      "-f",
      `description=${descFlag}`,
    ]);
  } else {
    // Add from disk (`--add <path>`, no `-`), remove, or those combined with
    // --desc. Each provides an explicit file selector so gh never prompts, and
    // none reads stdin.
    const ghArgs = ["gist", "edit", id];
    if (addFlag !== undefined) ghArgs.push("--add", addFlag);
    if (removeFlag !== undefined) ghArgs.push("--remove", removeFlag);
    if (descFlag !== undefined) ghArgs.push("--desc", descFlag);
    await ghExec(ghArgs);
  }

  const suggestions = getSuggestions({ domain: "gist", action: "edit", id });
  return renderOutput([
    encode({ edited: "ok", gist: id }),
    renderHelp(suggestions),
  ]);
}

// renameGist has no ctx parameter — see gistCommand note below.
async function renameGist(args: string[]): Promise<string> {
  // args[0] = "rename", args[1..] = positionals and (no) flags
  const allAfterSub = args.slice(1);

  // Reject any flags — rename has none.
  const unknownFlags = allAfterSub.filter((a) => a.startsWith("-"));
  if (unknownFlags.length > 0) {
    throw new AxiError(
      `gist rename takes no flags; unexpected: ${unknownFlags.join(", ")}`,
      "VALIDATION_ERROR",
    );
  }

  const positionals = allAfterSub;

  if (positionals.length < 3) {
    throw new AxiError(
      "usage: gh-axi gist rename <id|url> <old> <new>",
      "VALIDATION_ERROR",
    );
  }

  if (positionals.length > 3) {
    throw new AxiError(
      `too many arguments; expected: gh-axi gist rename <id|url> <old> <new>`,
      "VALIDATION_ERROR",
    );
  }

  const [id, oldName, newName] = positionals as [string, string, string];

  await ghExec(["gist", "rename", id, oldName, newName]);

  const suggestions = getSuggestions({ domain: "gist", action: "rename", id });
  return renderOutput([
    encode({ renamed: "ok", gist: id, from: oldName, to: newName }),
    renderHelp(suggestions),
  ]);
}

// gistCommand has no ctx parameter — gist is user-scoped and ctx must never
// reach ghJson. TypeScript accepts (args: string[]) as CommandFn because
// fewer parameters are always assignable to a type with more optional params.
// See AGENTS.md "User-scoped commands" section.
export async function gistCommand(args: string[]): Promise<string> {
  const sub = args[0];
  if (sub === "--help" || sub === undefined) return GIST_HELP;

  switch (sub) {
    case "list":
      return listGists(args);
    case "view":
      return viewGist(args);
    case "edit":
      return editGist(args);
    case "rename":
      return renameGist(args);
    case "create":
      return createGist(args);
    case "delete":
      return deleteGist(args);
    case "clone":
      return cloneGist(args);
    default:
      return renderError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Available subcommands: list, view, edit, rename, create, delete, clone",
      ]);
  }
}
