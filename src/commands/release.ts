import { encode } from "@toon-format/toon";
import type { RepoContext } from "../context.js";
import { ghJson, ghExec } from "../gh.js";
import { AxiError } from "../errors.js";
import { getFlag, hasFlag, takeBoolFlag, takeFlag } from "../args.js";
import { truncateBody } from "../body.js";
import {
  field,
  boolYesNo,
  relativeTime,
  pluck,
  custom,
  renderList,
  renderDetail,
  renderHelp,
  renderOutput,
  renderError,
  type FieldDef,
} from "../toon.js";
import { getSuggestions } from "../suggestions.js";

export const RELEASE_HELP = `usage: gh-axi release <subcommand> [flags]
subcommands[7]:
  list, view <tag>, create <tag>, edit <tag>, delete <tag>, download <tag>, upload <tag>
flags{list}:
  --exclude-drafts, --exclude-pre-releases, --limit (default 10)
flags{view}:
  --full (show complete release notes without truncation)
flags{create}:
  --title/-t, --notes/-n, --notes-file/-F, --draft/-d, --prerelease/-p, --target, --generate-notes, --discussion-category, --notes-start-tag, --verify-tag, --notes-from-tag, --fail-on-no-commits, --latest[=true|false], <files...>
flags{edit}:
  --title, --notes, --draft, --prerelease
flags{download}:
  --pattern, --dir
examples:
  gh-axi release list --exclude-drafts
  gh-axi release view v1.2.0 --full
  gh-axi release create v1.3.0 --generate-notes --draft dist/app.zip`;

const listSchema: FieldDef[] = [
  field("tagName", "tag"),
  field("name"),
  boolYesNo("isDraft", "draft"),
  boolYesNo("isPrerelease", "prerelease"),
  relativeTime("publishedAt", "published"),
];

const viewSchema: FieldDef[] = [
  field("tagName", "tag"),
  field("name"),
  relativeTime("publishedAt", "published"),
  pluck("author", "login", "author"),
  custom("body", (item) => truncateBody(item.body, 1000)),
];

const viewSchemaFull: FieldDef[] = [
  field("tagName", "tag"),
  field("name"),
  relativeTime("publishedAt", "published"),
  pluck("author", "login", "author"),
  custom("body", (item) => (typeof item.body === "string" ? item.body : "")),
];

function takeFirstFlag(args: string[], flags: string[]): string | undefined {
  for (const flag of flags) {
    const value = takeFlag(args, flag);
    if (value !== undefined) return value;
  }
  return undefined;
}

function appendValueFlag(
  ghArgs: string[],
  args: string[],
  outputFlag: string,
  inputFlags: string[] = [outputFlag],
): void {
  const value = takeFirstFlag(args, inputFlags);
  if (value !== undefined) ghArgs.push(outputFlag, value);
}

function appendBoolFlag(
  ghArgs: string[],
  args: string[],
  outputFlag: string,
  inputFlags: string[] = [outputFlag],
): void {
  if (inputFlags.some((flag) => takeBoolFlag(args, flag))) {
    ghArgs.push(outputFlag);
  }
}

function appendOptionalValueBoolFlag(
  ghArgs: string[],
  args: string[],
  outputFlag: string,
  inputFlags: string[] = [outputFlag],
): void {
  for (const flag of inputFlags) {
    const equalsPrefix = `${flag}=`;
    const equalsIndex = args.findIndex((arg) => arg.startsWith(equalsPrefix));
    if (equalsIndex !== -1) {
      ghArgs.push(
        `${outputFlag}=${args[equalsIndex].slice(equalsPrefix.length)}`,
      );
      args.splice(equalsIndex, 1);
      return;
    }
  }
  appendBoolFlag(ghArgs, args, outputFlag, inputFlags);
}

async function listReleases(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const limit = getFlag(args, "--limit") ?? "10";
  const ghArgs = [
    "release",
    "list",
    "--json",
    "tagName,name,isDraft,isPrerelease,publishedAt",
    "--limit",
    limit,
  ];
  if (hasFlag(args, "--exclude-drafts")) ghArgs.push("--exclude-drafts");
  if (hasFlag(args, "--exclude-pre-releases"))
    ghArgs.push("--exclude-pre-releases");

  const releases = await ghJson<Record<string, unknown>[]>(ghArgs, ctx);
  const isEmpty = releases.length === 0;
  const limitNum = Number(limit);
  const countLine =
    releases.length === limitNum
      ? `count: ${releases.length} (showing first ${releases.length}; run \`gh-axi repo view\` for total count)`
      : `count: ${releases.length}`;
  const suggestions = getSuggestions({
    domain: "release",
    action: "list",
    isEmpty,
    repo: ctx,
  });
  return renderOutput([
    countLine,
    renderList("releases", releases, listSchema),
    renderHelp(suggestions),
  ]);
}

async function viewRelease(args: string[], ctx?: RepoContext): Promise<string> {
  const full = hasFlag(args, "--full");
  const positionals = args.filter((a) => !a.startsWith("--"));
  const tag = positionals[1];
  if (!tag)
    throw new AxiError(
      "Tag is required: gh-axi release view <tag>",
      "VALIDATION_ERROR",
    );

  const release = await ghJson<Record<string, unknown>>(
    ["release", "view", tag, "--json", "tagName,name,publishedAt,author,body"],
    ctx,
  );

  return renderOutput([
    renderDetail("release", release, full ? viewSchemaFull : viewSchema),
  ]);
}

async function createRelease(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const remaining = args.slice(1);
  const optionArgs: string[] = [];

  appendValueFlag(optionArgs, remaining, "--title", ["--title", "-t"]);
  appendValueFlag(optionArgs, remaining, "--notes", ["--notes", "-n"]);
  appendValueFlag(optionArgs, remaining, "--notes-file", [
    "--notes-file",
    "-F",
  ]);
  appendValueFlag(optionArgs, remaining, "--target");
  appendValueFlag(optionArgs, remaining, "--discussion-category");
  appendValueFlag(optionArgs, remaining, "--notes-start-tag");
  appendBoolFlag(optionArgs, remaining, "--draft", ["--draft", "-d"]);
  appendBoolFlag(optionArgs, remaining, "--prerelease", ["--prerelease", "-p"]);
  appendBoolFlag(optionArgs, remaining, "--generate-notes");
  appendBoolFlag(optionArgs, remaining, "--verify-tag");
  appendBoolFlag(optionArgs, remaining, "--notes-from-tag");
  appendBoolFlag(optionArgs, remaining, "--fail-on-no-commits");
  appendOptionalValueBoolFlag(optionArgs, remaining, "--latest");

  const positionals = remaining.filter((a) => !a.startsWith("-"));
  const tag = positionals[0];
  if (!tag)
    throw new AxiError(
      "Tag is required: gh-axi release create <tag>",
      "VALIDATION_ERROR",
    );

  const ghArgs = [
    "release",
    "create",
    tag,
    ...optionArgs,
    ...positionals.slice(1),
  ];

  await ghExec(ghArgs, ctx);
  const suggestions = getSuggestions({
    domain: "release",
    action: "create",
    id: tag,
    repo: ctx,
  });
  return renderOutput([
    encode({ created: "ok", tag }),
    renderHelp(suggestions),
  ]);
}

async function editRelease(args: string[], ctx?: RepoContext): Promise<string> {
  const positionals = args.filter((a) => !a.startsWith("--"));
  const tag = positionals[1];
  if (!tag)
    throw new AxiError(
      "Tag is required: gh-axi release edit <tag>",
      "VALIDATION_ERROR",
    );

  const ghArgs = ["release", "edit", tag];
  const title = getFlag(args, "--title");
  if (title) ghArgs.push("--title", title);
  const notes = getFlag(args, "--notes");
  if (notes) ghArgs.push("--notes", notes);
  if (hasFlag(args, "--draft")) ghArgs.push("--draft");
  if (hasFlag(args, "--prerelease")) ghArgs.push("--prerelease");

  await ghExec(ghArgs, ctx);
  const suggestions = getSuggestions({
    domain: "release",
    action: "edit",
    id: tag,
    repo: ctx,
  });
  return renderOutput([encode({ edit: "ok", tag }), renderHelp(suggestions)]);
}

async function deleteRelease(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const positionals = args.filter((a) => !a.startsWith("--"));
  const tag = positionals[1];
  if (!tag)
    throw new AxiError(
      "Tag is required: gh-axi release delete <tag>",
      "VALIDATION_ERROR",
    );

  // Idempotent: check if release exists before deleting
  try {
    await ghJson<Record<string, unknown>>(
      ["release", "view", tag, "--json", "tagName"],
      ctx,
    );
  } catch (err) {
    if (err instanceof AxiError && err.code === "NOT_FOUND") {
      const suggestions = getSuggestions({
        domain: "release",
        action: "delete",
        id: tag,
        repo: ctx,
      });
      return renderOutput([
        encode({ delete: "already_deleted", tag }),
        renderHelp(suggestions),
      ]);
    }
    throw err;
  }

  await ghExec(["release", "delete", tag, "--yes"], ctx);
  const suggestions = getSuggestions({
    domain: "release",
    action: "delete",
    id: tag,
    repo: ctx,
  });
  return renderOutput([encode({ delete: "ok", tag }), renderHelp(suggestions)]);
}

async function downloadRelease(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const positionals = args.filter((a) => !a.startsWith("--"));
  const tag = positionals[1];
  if (!tag)
    throw new AxiError(
      "Tag is required: gh-axi release download <tag>",
      "VALIDATION_ERROR",
    );

  const ghArgs = ["release", "download", tag];
  const pattern = getFlag(args, "--pattern");
  if (pattern) ghArgs.push("--pattern", pattern);
  const dir = getFlag(args, "--dir");
  if (dir) ghArgs.push("--dir", dir);

  await ghExec(ghArgs, ctx);
  const suggestions = getSuggestions({
    domain: "release",
    action: "download",
    id: tag,
    repo: ctx,
  });
  return renderOutput([
    encode({ download: "ok", tag }),
    renderHelp(suggestions),
  ]);
}

async function uploadRelease(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const positionals = args.filter((a) => !a.startsWith("--"));
  const tag = positionals[1];
  if (!tag)
    throw new AxiError(
      "Tag is required: gh-axi release upload <tag> <files...>",
      "VALIDATION_ERROR",
    );

  const files = positionals.slice(2);
  if (files.length === 0)
    throw new AxiError(
      "At least one file is required: gh-axi release upload <tag> <files...>",
      "VALIDATION_ERROR",
    );

  await ghExec(["release", "upload", tag, ...files], ctx);
  const suggestions = getSuggestions({
    domain: "release",
    action: "upload",
    id: tag,
    repo: ctx,
  });
  return renderOutput([
    encode({ upload: "ok", tag, files: files.length }),
    renderHelp(suggestions),
  ]);
}

export async function releaseCommand(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const sub = args[0];

  if (sub === "--help" || sub === undefined) return RELEASE_HELP;

  switch (sub) {
    case "list":
      return listReleases(args, ctx);
    case "view":
      return viewRelease(args, ctx);
    case "create":
      return createRelease(args, ctx);
    case "edit":
      return editRelease(args, ctx);
    case "delete":
      return deleteRelease(args, ctx);
    case "download":
      return downloadRelease(args, ctx);
    case "upload":
      return uploadRelease(args, ctx);
    default:
      return renderError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Available subcommands: list, view, create, edit, delete, download, upload",
      ]);
  }
}
