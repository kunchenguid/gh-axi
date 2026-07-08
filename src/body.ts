import { readFileSync } from "node:fs";
import { AxiError } from "./errors.js";

/**
 * Shared body input, cleaning, and truncation for all entity types.
 *
 * Cleanups are only applied when content needs truncation.
 * When --full is used, the raw body is returned as-is.
 */

interface BodyFlagMatch {
  flag: string;
  value: string | undefined;
}

interface TakeBodyOptions {
  required?: boolean;
  inlineFlags?: string[];
  fileFlags?: string[];
  valueBoundaryFlags?: string[];
  label?: string;
  suggestions?: string[];
}

interface TruncateBodyOptions {
  fullHint?: string;
  originalHint?: string;
}

function defaultSuggestions(label: string): string[] {
  return [
    `Use --body "..." for inline ${label}, or --body-file <path> for markdown from a file`,
  ];
}

function isMissingValue(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

function isValueBoundary(arg: string | undefined, flags: string[]): boolean {
  if (arg === undefined) return false;
  return flags.some((flag) => arg === flag || arg.startsWith(`${flag}=`));
}

function takeFlagMatches(
  args: string[],
  flags: string[],
  valueBoundaryFlags: string[],
): BodyFlagMatch[] {
  const matches: BodyFlagMatch[] = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    let matched = false;

    for (const flag of flags) {
      const equalsPrefix = `${flag}=`;
      if (arg === flag) {
        const next = args[index + 1];
        const value =
          next !== undefined && !isValueBoundary(next, valueBoundaryFlags)
            ? next
            : undefined;
        const consumeCount = value === undefined ? 1 : 2;
        args.splice(index, consumeCount);
        index--;
        matches.push({ flag, value });
        matched = true;
        break;
      }

      if (arg.startsWith(equalsPrefix)) {
        args.splice(index, 1);
        index--;
        matches.push({ flag, value: arg.slice(equalsPrefix.length) });
        matched = true;
        break;
      }
    }

    if (matched) continue;
  }

  return matches;
}

function readBodyFile(
  flag: string,
  path: string,
  suggestions: string[],
): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as NodeJS.ErrnoException).code)
        : "UNKNOWN";
    if (code === "ENOENT") {
      throw new AxiError(
        `${flag} path not found: ${path}`,
        "VALIDATION_ERROR",
        suggestions,
      );
    }
    if (code === "EISDIR") {
      throw new AxiError(
        `${flag} must point to a readable UTF-8 file, not a directory: ${path}`,
        "VALIDATION_ERROR",
        suggestions,
      );
    }
    throw new AxiError(
      `Could not read ${flag} path: ${path} (${code})`,
      "VALIDATION_ERROR",
      suggestions,
    );
  }
}

/**
 * Resolve a command body from inline text or a UTF-8 file and remove the flags.
 *
 * Optional bodies accept at most one source. Required bodies enforce exactly
 * one source and raise validation errors for missing, conflicting, or
 * unreadable input.
 */
export function takeBody(
  args: string[],
  options: TakeBodyOptions & { required: true },
): string;
export function takeBody(
  args: string[],
  options?: TakeBodyOptions,
): string | undefined;
export function takeBody(
  args: string[],
  options: TakeBodyOptions = {},
): string | undefined {
  const inlineFlags = options.inlineFlags ?? ["--body"];
  const fileFlags = options.fileFlags ?? ["--body-file"];
  const valueBoundaryFlags = [
    ...new Set([
      ...inlineFlags,
      ...fileFlags,
      ...(options.valueBoundaryFlags ?? []),
    ]),
  ];
  const label = options.label ?? "body";
  const suggestions = options.suggestions ?? defaultSuggestions(label);
  const inlineMatches = takeFlagMatches(args, inlineFlags, valueBoundaryFlags);
  const fileMatches = takeFlagMatches(args, fileFlags, valueBoundaryFlags);
  const matches = [...inlineMatches, ...fileMatches];

  if (matches.length === 0) {
    if (options.required) {
      throw new AxiError(
        `${inlineFlags[0]} or ${fileFlags[0]} is required`,
        "VALIDATION_ERROR",
        suggestions,
      );
    }
    return undefined;
  }

  if (matches.length > 1) {
    throw new AxiError(
      `Use only one ${label} source: ${matches.map((m) => m.flag).join(", ")} were provided`,
      "VALIDATION_ERROR",
      suggestions,
    );
  }

  const match = matches[0];
  const value = match.value;
  if (isMissingValue(value)) {
    const noun = fileFlags.includes(match.flag) ? "path" : "text";
    throw new AxiError(
      `${match.flag} requires ${noun}`,
      "VALIDATION_ERROR",
      suggestions,
    );
  }
  const resolvedValue = value ?? "";

  if (fileFlags.includes(match.flag)) {
    return readBodyFile(match.flag, resolvedValue, suggestions);
  }

  return resolvedValue;
}

/** Clean up a body string to reduce token cost before truncation. */
export function cleanBody(text: string): string {
  // Normalize GitHub PR/issue URLs to short references
  let s = text.replace(
    /\[([^\]]+)\]\(https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)\)/g,
    "[$1](PR#$2)",
  );
  s = s.replace(
    /\[([^\]]+)\]\(https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)\)/g,
    "[$1](Issue#$2)",
  );
  s = s.replace(
    /(?<!\()https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/g,
    "PR#$1",
  );
  s = s.replace(
    /(?<!\()https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/g,
    "Issue#$1",
  );
  // Strip markdown image embeds: ![alt](url) → [image: alt]
  s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, (_m, alt) =>
    alt ? `[image: ${alt}]` : "[image]",
  );
  // Strip long URLs (>80 chars) in markdown links: [text](longurl) → [text]
  s = s.replace(/\[([^\]]+)\]\(([^)]{80,})\)/g, "[$1]");
  // Strip standalone long URLs (>100 chars) not in markdown
  s = s.replace(/(?<!\()https?:\/\/\S{100,}/g, "[long URL removed]");
  // Collapse email-style quoted blocks (lines starting with >) to a summary
  s = s.replace(/(^|\n)(>\s?[^\n]*\n?){3,}/gm, "$1[quoted text removed]\n");
  return s;
}

/**
 * Truncate a body field for display.
 * Cleanups are only applied when truncation is needed.
 * Returns the raw body when it fits within maxLen.
 * Custom hints let callers avoid suggesting unavailable escape hatches.
 */
export function truncateBody(
  body: unknown,
  maxLen = 500,
  options: TruncateBodyOptions = {},
): string {
  if (typeof body !== "string" || !body) return "";
  if (body.length <= maxLen) return body;
  const originalHint = options.originalHint ?? "use --full to see original";
  const fullHint = options.fullHint ?? "use --full to see complete body";
  const cleaned = cleanBody(body);
  if (cleaned.length <= maxLen) {
    // Cleanup made it fit, but content was modified.
    if (cleaned !== body) {
      return (
        cleaned +
        "\n(cleaned, " +
        body.length +
        " chars original - " +
        originalHint +
        ")"
      );
    }
    return cleaned;
  }
  return (
    cleaned.slice(0, maxLen) +
    "\n... (truncated, " +
    cleaned.length +
    " chars total - " +
    fullHint +
    ")"
  );
}
