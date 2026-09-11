import { readFileSync } from "node:fs";
import { AxiError } from "./errors.js";
import { takeRequiredFlag } from "./args.js";

/**
 * Shared description input and truncation for entity bodies.
 *
 * glab takes inline text via `--description` and file content via
 * `--description-file`. glab-axi accepts both, reads the file itself, and
 * always forwards a concrete value so the wrapped `glab` child never opens an
 * interactive editor or confirmation prompt.
 */

/**
 * Resolve the description from --description <text> / --description=<text> or
 * --description-file <path>. Throws VALIDATION_ERROR for a flag given without
 * a usable value, or an unreadable file path.
 */
export function takeDescription(
  args: string[],
  options: { inlineFlag?: string; fileFlag?: string } = {},
): string | undefined {
  const inlineFlag = options.inlineFlag ?? "--description";
  const fileFlag = options.fileFlag ?? "--description-file";

  const inline = takeRequiredFlag(args, inlineFlag);
  const file = takeRequiredFlag(args, fileFlag);
  if (inline !== undefined && file !== undefined) {
    throw new AxiError(
      `Use either ${inlineFlag} or ${fileFlag}, not both`,
      "VALIDATION_ERROR",
    );
  }
  if (file !== undefined)
    return rejectEditorSentinel(readBodyFile(fileFlag, file), fileFlag);
  if (inline !== undefined) return rejectEditorSentinel(inline, inlineFlag);
  return undefined;
}

/**
 * glab reads a description of exactly "-" as "open an editor". Forwarding it
 * would hang the agent on an interactive prompt, so refuse it outright.
 */
function rejectEditorSentinel(value: string, flag: string): string {
  if (value === "-") {
    throw new AxiError(
      `${flag} value "-" tells glab to open an interactive editor; pass literal text instead`,
      "VALIDATION_ERROR",
    );
  }
  return value;
}

function readBodyFile(flag: string, path: string): string {
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
        [`Use ${flag} pointing at an existing UTF-8 file, or pass inline text`],
      );
    }
    if (code === "EISDIR") {
      throw new AxiError(
        `${flag} must point to a readable UTF-8 file, not a directory: ${path}`,
        "VALIDATION_ERROR",
      );
    }
    throw new AxiError(
      `Could not read ${flag} path: ${path} (${code})`,
      "VALIDATION_ERROR",
    );
  }
}

/** Truncate a long body for display, marking the cut. */
export function truncateBody(
  body: unknown,
  limit: number,
): string {
  if (typeof body !== "string" || body === "") return "";
  if (body.length <= limit) return body;
  return `${body.slice(0, limit)}... (truncated, use --full)`;
}
