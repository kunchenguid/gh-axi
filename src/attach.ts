import { statSync } from "node:fs";
import { extname } from "node:path";
import { getAllFlags, pushRepeated, takeAllFlags } from "./args.js";
import { AxiError } from "./errors.js";
import { field, renderList } from "./toon.js";

/** gh --attach shipped in GitHub CLI 2.99.0. */
export const ATTACH_MIN_GH_VERSION = "2.99.0";

export const ATTACH_FLAG = "--attach";

export const MAX_ATTACHMENTS = 50;

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".webm"]);

const SUPPORTED_LIST = "png, jpg, jpeg, gif, webp, svg, mp4, mov, webm";

const ASSET_URL_RE =
  /https:\/\/[^\s)]+\/user-attachments\/assets\/[A-Za-z0-9-]+/g;

export const ATTACH_BODY_OPTIONS: { valueBoundaryFlags: string[] } = {
  valueBoundaryFlags: [ATTACH_FLAG],
};

export type AttachKind = "image" | "video";

/** Pass to takeBody on attach-capable commands so `--body --attach` is not eaten as text. */
export function attachBodyOptions(required: boolean): {
  required: boolean;
  valueBoundaryFlags: string[];
} {
  return { required, valueBoundaryFlags: [ATTACH_FLAG] };
}

function pathExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

export function parseAttachSpec(raw: string): { file: string; alt: string } {
  if (pathExists(raw)) return { file: raw, alt: "" };

  for (
    let hash = raw.lastIndexOf("#");
    hash !== -1;
    hash = raw.lastIndexOf("#", hash - 1)
  ) {
    const file = raw.slice(0, hash);
    if (pathExists(file)) return { file, alt: raw.slice(hash + 1) };
  }

  return { file: raw, alt: "" };
}

export function attachmentKind(file: string): AttachKind {
  return VIDEO_EXTS.has(extname(file).toLowerCase()) ? "video" : "image";
}

export function extractAttachmentUrls(body: string): string[] {
  return body.match(ASSET_URL_RE) ?? [];
}

function attachError(message: string, suggestions: string[] = []): AxiError {
  return new AxiError(message, "VALIDATION_ERROR", suggestions);
}

function validateOne(raw: string): { file: string; kind: AttachKind } {
  const { file, alt } = parseAttachSpec(raw);
  if (file.trim() === "") {
    throw attachError("--attach requires a path");
  }

  let st;
  try {
    st = statSync(file);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as NodeJS.ErrnoException).code)
        : "";
    if (code === "ENOENT") {
      throw attachError(`--attach ${file}: no such file or directory`);
    }
    throw attachError(`--attach ${file}: could not stat file`);
  }

  if (st.isDirectory()) {
    throw attachError(`--attach ${file} is a directory`);
  }
  if (!st.isFile()) {
    throw attachError(`--attach ${file} is not a regular file`);
  }
  if (st.size === 0) {
    throw attachError(`--attach ${file} is empty`);
  }

  const ext = extname(file).toLowerCase();
  if (!IMAGE_EXTS.has(ext) && !VIDEO_EXTS.has(ext)) {
    throw attachError(
      `--attach ${file} is not a supported file type (supported: ${SUPPORTED_LIST})`,
    );
  }

  const kind = attachmentKind(file);
  if (kind === "video") {
    if (alt !== "") {
      throw attachError(`--attach: cannot set alt text on video (${file})`);
    }
    if (st.size > VIDEO_MAX_BYTES) {
      throw attachError(`--attach ${file}: videos must be at most 100 MB`);
    }
  } else if (st.size > IMAGE_MAX_BYTES) {
    throw attachError(`--attach ${file}: images must be at most 10 MB`);
  }

  return { file, kind };
}

/** Validate every `--attach` value. No-op when the flag is absent. */
export function validateAttachments(specs: string[]): void {
  if (specs.length === 0) return;
  if (specs.length > MAX_ATTACHMENTS) {
    throw attachError(
      `--attach accepts at most ${MAX_ATTACHMENTS} values per command`,
    );
  }
  for (const spec of specs) validateOne(spec);
}

export function collectAttachments(
  args: string[],
  mode: "get" | "take",
): string[] {
  const specs =
    mode === "take"
      ? takeAllFlags(args, ATTACH_FLAG)
      : getAllFlags(args, ATTACH_FLAG);
  validateAttachments(specs);
  return specs;
}

export function pushAttachments(ghArgs: string[], specs: string[]): void {
  pushRepeated(ghArgs, ATTACH_FLAG, specs);
}

/**
 * Named uploaded files plus every user-attachments URL in the resulting body.
 * URLs are listed separately rather than zipped to files: on edit, the body may
 * already contain older assets, so index pairing would be a lie.
 */
export function renderAttachOutput(
  specs: string[],
  body: string | undefined,
): string {
  if (specs.length === 0) return "";
  const files = specs.map((raw) => {
    const { file } = parseAttachSpec(raw);
    return { file, kind: attachmentKind(file) };
  });
  const urls = extractAttachmentUrls(body ?? "").map((url) => ({ url }));
  const blocks = [
    renderList("attachments", files, [field("file"), field("kind")]),
  ];
  if (urls.length > 0) {
    blocks.push(renderList("asset_urls", urls, [field("url")]));
  }
  return blocks.join("\n");
}
