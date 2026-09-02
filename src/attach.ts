import { getAllFlags, pushRepeated, takeAllFlags } from "./args.js";
import { MutationFollowupError } from "./errors.js";
import { field, renderList } from "./toon.js";

export const ATTACH_MIN_GH_VERSION = "2.99.0";

export const ATTACH_FLAG = "--attach";

const ASSET_URL_RE =
  /https:\/\/[^\s)]+\/user-attachments\/assets\/[A-Za-z0-9-]+/g;

export const ATTACH_BODY_OPTIONS: { valueBoundaryFlags: string[] } = {
  valueBoundaryFlags: [ATTACH_FLAG],
};

export function attachBodyOptions(required: boolean): {
  required: boolean;
  valueBoundaryFlags: string[];
} {
  return { required, valueBoundaryFlags: [ATTACH_FLAG] };
}

export function hasAttachmentFlag(args: string[]): boolean {
  const equalsPrefix = `${ATTACH_FLAG}=`;
  return args.some(
    (arg) => arg === ATTACH_FLAG || arg.startsWith(equalsPrefix),
  );
}

export function extractAttachmentUrls(body: string): string[] {
  return body.match(ASSET_URL_RE) ?? [];
}

export function collectAttachments(
  args: string[],
  mode: "get" | "take",
): string[] {
  return mode === "take"
    ? takeAllFlags(args, ATTACH_FLAG)
    : getAllFlags(args, ATTACH_FLAG);
}

export function pushAttachments(ghArgs: string[], specs: string[]): void {
  pushRepeated(ghArgs, ATTACH_FLAG, specs);
}

export async function preserveAttachMutation<T>(
  mutationState: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw MutationFollowupError.from(mutationState, error);
  }
}

export function newAttachmentUrls(
  body: string | undefined,
  baselineBody: string | undefined = "",
): string[] {
  const seenUrls = new Set(extractAttachmentUrls(baselineBody ?? ""));
  return extractAttachmentUrls(body ?? "").filter((url) => {
    if (seenUrls.has(url)) return false;
    seenUrls.add(url);
    return true;
  });
}

export function renderAttachOutput(
  specs: string[],
  body: string | undefined,
  baselineBody: string | undefined = "",
): string {
  if (specs.length === 0) return "";
  const files = specs.map((file) => ({ file }));
  const urls = newAttachmentUrls(body, baselineBody).map((url) => ({ url }));
  const blocks = [renderList("attachments", files, [field("file")])];
  if (urls.length > 0) {
    blocks.push(renderList("asset_urls", urls, [field("url")]));
  }
  return blocks.join("\n");
}
