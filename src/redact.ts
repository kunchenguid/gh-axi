import { AxiError } from "./errors.js";

// Normalize spelling/case so camelCase and snake_case share one policy. Public
// keys, key IDs, and token counts are intentionally not credential values.
const CREDENTIAL_KEY_PATTERN =
  "token(?:value|data|hash)?$|secret|password|passwd|passphrase|credential|authorization|privatekey|(?:signing|encryption|decryption|session|api|access|client|auth)key(?:value|pem|data)?$|^(?:jwt|bearer|authheader)$";
const credentialKey = new RegExp(CREDENTIAL_KEY_PATTERN);

export function isCredentialKey(key: string): boolean {
  return credentialKey.test(key.toLowerCase().replace(/[^a-z0-9]/g, ""));
}

export function omitCredential(key: string, value: unknown): unknown {
  return isCredentialKey(key) ? undefined : value;
}

/** Executed by gh before a user jq projection can erase/rename field names. */
const REDACT_JQ = `walk(if type == "object" then with_entries(select(.key | ascii_downcase | gsub("[^a-z0-9]"; "") | test(${JSON.stringify(CREDENTIAL_KEY_PATTERN)}) | not)) else . end)`;

export const TEMPLATE_REFUSAL =
  "--template is not supported for API responses; use --jq instead so credential fields can be redacted before selection";

/** Only API output flags are rewritten; other commands' template flags differ. */
export function redactApiArgs(args: string[]): string[] {
  if (args[0] !== "api") return [...args];
  const result = [...args];
  const valueFlags = new Set([
    "-X",
    "--method",
    "-F",
    "--field",
    "-f",
    "--raw-field",
    "-H",
    "--header",
    "--input",
    "--hostname",
    "--cache",
    "-p",
    "--preview",
  ]);
  for (let i = 1; i < result.length; i++) {
    const arg = result[i];
    const equals = arg.indexOf("=");
    const name = equals < 0 ? arg : arg.slice(0, equals);
    if (valueFlags.has(name)) {
      if (equals < 0) i++;
      continue;
    }
    if (name === "--template" || name === "-t") {
      throw new AxiError(TEMPLATE_REFUSAL, "VALIDATION_ERROR");
    }
    if (name === "--jq" || name === "-q") {
      const query = equals < 0 ? result[i + 1] : arg.slice(equals + 1);
      if (query === undefined)
        throw new AxiError("--jq requires a value", "VALIDATION_ERROR");
      const safeQuery = `${REDACT_JQ} | (\n${query}\n)`;
      if (equals < 0) result[++i] = safeQuery;
      else result[i] = `${name}=${safeQuery}`;
    }
  }
  return result;
}

function unsafeResponse(): AxiError {
  return new AxiError(
    "JSON response could not be safely redacted; body withheld",
    "UNKNOWN",
    ["Check the upstream response format and request JSON output"],
  );
}

/**
 * Sanitize JSON before any rendering, including concatenated --paginate pages.
 * Preserve ordinary text and unchanged JSON byte-for-byte. Never fall back to
 * raw output for malformed JSON containers or credential-bearing field text.
 */
export function redactResponseText(raw: string, strict = true): string {
  let changed = false;
  const parse = (text: string): unknown =>
    JSON.parse(text, (key, value) => {
      if (isCredentialKey(key)) {
        changed = true;
        return undefined;
      }
      return value;
    });
  try {
    const value = parse(raw);
    return changed ? JSON.stringify(value) : raw;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw unsafeResponse();
    // Ordinary command text is not an API/JSON pipeline. Still redact it when
    // it is valid JSON, without treating logs or patches as malformed JSON.
    if (!strict) return raw;
    // A response may be several adjacent arrays/objects, not one JSON value.
  }

  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    // A malformed/embedded JSON field must not bypass the JSON parser via the
    // ordinary non-JSON output path. Inspect names only, never echo a value.
    for (const match of raw.matchAll(/"((?:\\.|[^"\\])*)"\s*:/g)) {
      try {
        if (isCredentialKey(JSON.parse(`"${match[1]}"`)))
          throw unsafeResponse();
      } catch (error) {
        if (error instanceof AxiError) throw error;
        throw unsafeResponse();
      }
    }
    return raw;
  }

  const pages: unknown[] = [];
  let start = 0;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  try {
    for (let i = 0; i < trimmed.length; i++) {
      const char = trimmed[i];
      if (depth === 0) {
        if (/\s/.test(char)) continue;
        if (char !== "{" && char !== "[") throw unsafeResponse();
        start = i;
      }
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === "{" || char === "[") depth++;
      else if (char === "}" || char === "]") {
        depth--;
        if (depth === 0) pages.push(parse(trimmed.slice(start, i + 1)));
      }
    }
    if (depth !== 0 || quoted || pages.length === 0) throw unsafeResponse();
    return changed ? pages.map((page) => JSON.stringify(page)).join("\n") : raw;
  } catch {
    throw unsafeResponse();
  }
}
