import { encode } from "@toon-format/toon";
import type { ProjectContext } from "../context.js";
import { glabExec } from "../glab.js";
import { AxiError } from "../errors.js";
import { getSuggestions } from "../suggestions.js";
import { renderHelp, renderOutput } from "../toon.js";

export const API_HELP = `usage: glab-axi api [<method>] <path>
description: Make an authenticated GitLab API request (passthrough to glab api). Method defaults to GET, or POST when --field/--raw-field is given (glab's own default).
methods[6]:
  GET, POST, PUT, PATCH, DELETE, HEAD
flags[7]:
  -X <method> or -X=<method> (alias for the positional method; give once and do not combine with a positional method), --field <key=value> (repeatable; forwarded as glab's typed -F), --raw-field <key=value> (repeatable; forwarded as glab's -f), --header <key:value> (repeatable), --input <file> (raw request body file), --paginate, --full (preserve complete field values without truncation)
examples:
  glab-axi api projects/group%2Fproject
  glab-axi api projects/:fullpath/merge_requests
  glab-axi api POST projects/group%2Fproject/issues --field title="Bug report"
  glab-axi api -X POST projects/group%2Fproject/issues --field title="Bug report"
  glab-axi api projects/group%2Fproject/merge_requests --paginate
  glab-axi api graphql --raw-field query='{ project(fullPath: "group/project") { issues { nodes { iid title } } } }'`;

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);

/** The `glab api` short flag for HTTP method, equivalent to the positional method. */
const METHOD_FLAG = "-X";

/** Value flags that may be given more than once, each occurrence forwarded to glab. */
const REPEATABLE_VALUE_FLAGS = new Set(["--field", "--raw-field", "--header"]);

/** Value flags that glab accepts only one of, so a repeat is a caller mistake. */
const SINGLE_VALUE_FLAGS = new Set(["--input"]);

/** Flags that stand alone and must not consume the following argument, and are forwarded to glab. */
const BOOL_FLAGS = new Set(["--paginate"]);

/** Flags that stand alone, are glab-axi-only, and must not be forwarded to glab. */
const LOCAL_BOOL_FLAGS = new Set(["--full"]);

const SUPPORTED_FLAGS = [
  METHOD_FLAG,
  ...REPEATABLE_VALUE_FLAGS,
  ...SINGLE_VALUE_FLAGS,
  ...BOOL_FLAGS,
  ...LOCAL_BOOL_FLAGS,
];

/** The flag's name without any `=value` suffix, so errors never echo a value. */
function flagName(arg: string): string {
  const equals = arg.indexOf("=");
  return equals === -1 ? arg : arg.slice(0, equals);
}

interface ParsedApiArgs {
  positionals: string[];
  fields: string[];
  rawFields: string[];
  headers: string[];
  method?: string;
  input?: string;
  paginate: boolean;
  full: boolean;
}

/**
 * Walk args once, collecting positionals and flag values and rejecting anything
 * unrecognised. Unknown flags must fail loudly, never vanish together with
 * their value, and only flags known to take a value consume the next argument.
 */
function parseArgs(args: string[]): ParsedApiArgs {
  const parsed: ParsedApiArgs = {
    positionals: [],
    fields: [],
    rawFields: [],
    headers: [],
    paginate: false,
    full: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("-")) {
      parsed.positionals.push(arg);
      continue;
    }
    const name = flagName(arg);
    if (BOOL_FLAGS.has(name)) {
      if (name !== arg)
        throw new AxiError(`${name} does not take a value`, "VALIDATION_ERROR");
      parsed.paginate = true;
      continue;
    }
    if (LOCAL_BOOL_FLAGS.has(name)) {
      if (name !== arg)
        throw new AxiError(`${name} does not take a value`, "VALIDATION_ERROR");
      parsed.full = true;
      continue;
    }
    if (
      name !== METHOD_FLAG &&
      !REPEATABLE_VALUE_FLAGS.has(name) &&
      !SINGLE_VALUE_FLAGS.has(name)
    ) {
      throw new AxiError(
        `unknown flag ${name} for glab-axi api. Supported flags: ${SUPPORTED_FLAGS.join(", ")}`,
        "VALIDATION_ERROR",
      );
    }
    // `--flag=value` carries its own value; `--flag value` consumes the next arg.
    let value: string;
    if (name === arg) {
      const next = args[i + 1];
      if (
        next === undefined ||
        (name === "--input" && SUPPORTED_FLAGS.includes(flagName(next)))
      )
        throw new AxiError(`${name} requires a value`, "VALIDATION_ERROR");
      value = next;
      i++;
    } else {
      value = arg.slice(name.length + 1);
    }
    if (name === METHOD_FLAG) {
      if (parsed.method !== undefined)
        throw new AxiError(
          `${name} may only be given once`,
          "VALIDATION_ERROR",
        );
      const upper = value.toUpperCase();
      if (!HTTP_METHODS.has(upper)) {
        throw new AxiError(
          `${name} ${value} is not a supported HTTP method. Supported: ${[...HTTP_METHODS].join(", ")}`,
          "VALIDATION_ERROR",
        );
      }
      parsed.method = upper;
    } else if (name === "--field") {
      parsed.fields.push(value);
    } else if (name === "--raw-field") {
      parsed.rawFields.push(value);
    } else if (name === "--header") {
      parsed.headers.push(value);
    } else {
      // glab takes the last occurrence; discarding the earlier value silently
      // is a silent mutation, so reject instead.
      if (parsed.input !== undefined)
        throw new AxiError(
          `${name} may only be given once`,
          "VALIDATION_ERROR",
        );
      if (value.trim() === "")
        throw new AxiError(`${name} requires a value`, "VALIDATION_ERROR");
      parsed.input = value;
    }
  }
  return parsed;
}

/**
 * A raw API path that a structured glab-axi command already wraps, so the
 * output can point at the cheaper command for the same resource.
 */
const WRAPPED_RESOURCE =
  /^\/?projects\/([^/]+)\/(merge_requests|issues)(?:\/(\d+))?\/?$/;

/**
 * Resolve the project a raw API path names. glab's `:fullpath`/`:id`
 * placeholders mean "the current project", so they keep the caller's context;
 * an explicit path targets that project. Anything else — a numeric project id
 * above all — names a project this command cannot resolve, and guessing the
 * caller's would point the suggestion at a different project.
 */
function projectFromPathSegment(
  segment: string,
  ctx?: ProjectContext,
): ProjectContext | undefined {
  if (segment === ":fullpath" || segment === ":id") return ctx;
  const fullPath = segment.replace(/%2f/gi, "/");
  if (!/^[\w.-]+(?:\/[\w.-]+)+$/.test(fullPath)) return undefined;
  return { fullPath, source: "flag" };
}

/** Maximum length for raw (non-JSON) API output before truncation. */
const RAW_OUTPUT_TRUNCATION_LIMIT = 4000;

/** Strings longer than this threshold are truncated. */
const STRING_VALUE_TRUNCATION_LIMIT = 2000;

export async function apiCommand(
  args: string[],
  ctx?: ProjectContext,
): Promise<string> {
  if (args[0] === "--help" || args[0] === "-h" || args.length === 0)
    return API_HELP;

  const { positionals, fields, rawFields, headers, method: methodFlag, input, paginate, full } =
    parseArgs(args);

  const pathRequired = new AxiError(
    "API path is required: glab-axi api [<method>] <path>",
    "VALIDATION_ERROR",
  );
  if (positionals.length === 0) throw pathRequired;

  // A positional the command cannot place is a caller typo, and dropping it
  // silently requests a different endpoint than the one that was asked for.
  const methodGiven = HTTP_METHODS.has(positionals[0].toUpperCase());
  if (methodFlag !== undefined && methodGiven) {
    throw new AxiError(
      "method given twice: use either -X <method> or the positional method, not both",
      "VALIDATION_ERROR",
    );
  }
  if (positionals.length > (methodGiven ? 2 : 1)) {
    throw new AxiError(
      "too many arguments for glab-axi api: expected [<method>] <path>",
      "VALIDATION_ERROR",
    );
  }
  if (methodGiven && positionals.length < 2) throw pathRequired;

  const method = methodFlag ?? (methodGiven ? positionals[0].toUpperCase() : undefined);
  const path = methodGiven ? positionals[1] : positionals[0];

  const glabArgs = ["api", path];
  // Only forward an explicit method; otherwise glab applies its own default
  // (GET without params, POST when params are given).
  if (method) glabArgs.push("-X", method);

  for (const f of fields) {
    glabArgs.push("--field", f);
  }
  for (const f of rawFields) {
    glabArgs.push("--raw-field", f);
  }
  for (const h of headers) {
    glabArgs.push("--header", h);
  }
  if (input !== undefined) {
    glabArgs.push("--input", input);
  }
  if (paginate) glabArgs.push("--paginate");

  const wrapped = path.split("?")[0].match(WRAPPED_RESOURCE);
  const wrappedProject = wrapped
    ? projectFromPathSegment(wrapped[1], ctx)
    : undefined;
  const help = renderHelp(
    getSuggestions(
      wrapped && wrappedProject
        ? {
            domain: "api",
            action: wrapped[2] === "merge_requests" ? "mr" : "issue",
            id: wrapped[3],
            repo: wrappedProject,
          }
        : { domain: "api", action: "raw", repo: ctx },
    ),
  );

  // Try to parse as JSON, strip noisy fields, encode to TOON; fall back to raw output
  const raw = await glabExec(glabArgs, ctx);
  try {
    const data = JSON.parse(raw);
    return renderOutput([encode(shapeOutput(data, !full, !full)), help]);
  } catch {
    // Not JSON — wrap in TOON envelope with truncation metadata
    const trimmed = raw.trim();
    const truncated = !full && trimmed.length > RAW_OUTPUT_TRUNCATION_LIMIT;
    const result: Record<string, unknown> = {
      api_response: {
        body: truncated
          ? trimmed.slice(0, RAW_OUTPUT_TRUNCATION_LIMIT)
          : trimmed,
        truncated,
      },
    };
    if (truncated) {
      (result.api_response as Record<string, unknown>).original_length =
        trimmed.length;
    }
    return renderOutput([encode(result), help]);
  }
}

/** Fields from raw GitLab API responses that are noisy/useless for agents */
const NOISY_KEYS = new Set(["_links", "container_registry_image_prefix"]);

/**
 * Fields carrying a credential. These are dropped from every response, --full
 * included: --full widens truncation, it is not consent to print a secret.
 */
const SECRET_KEYS = new Set(["runners_token"]);

/** Keys ending in _url that are template URLs agents never use */
function isTemplateUrlKey(key: string): boolean {
  if (!key.endsWith("_url")) return false;
  // Keep a few meaningful URL keys
  const KEEP_URL_KEYS = new Set([
    "web_url",
    "readme_url",
    "ssh_url_to_repo",
    "http_url_to_repo",
    "merge_request_url",
  ]);
  return !KEEP_URL_KEYS.has(key);
}

/** Bound a string value's length, leaving its content untouched. */
function truncateString(value: string): string {
  if (value.length <= STRING_VALUE_TRUNCATION_LIMIT) return value;
  return value.slice(0, STRING_VALUE_TRUNCATION_LIMIT) + "... (truncated)";
}

/**
 * Walk a decoded API response, dropping secret keys and bounding every string
 * value.
 *
 * With `stripNoisyKeys` the noisy keys are dropped as well. With
 * `truncateValues` false (--full), string values pass through untouched.
 */
function shapeOutput(
  obj: unknown,
  stripNoisyKeys: boolean,
  truncateValues: boolean,
  depth = 0,
): unknown {
  if (depth > 8) return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) =>
      shapeOutput(item, stripNoisyKeys, truncateValues, depth + 1),
    );
  }
  if (obj !== null && typeof obj === "object") {
    const record = obj as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (SECRET_KEYS.has(key)) continue;
      if (!stripNoisyKeys) {
        result[key] = shapeOutput(
          value,
          stripNoisyKeys,
          truncateValues,
          depth + 1,
        );
        continue;
      }
      if (NOISY_KEYS.has(key)) continue;
      if (isTemplateUrlKey(key)) continue;
      // Strip nested user objects down to just username
      if (
        (key === "author" || key === "assignee" || key === "owner" || key === "merged_by") &&
        value &&
        typeof value === "object" &&
        "username" in (value as Record<string, unknown>)
      ) {
        result[key] = (value as Record<string, unknown>).username;
        continue;
      }
      result[key] = shapeOutput(
        value,
        stripNoisyKeys,
        truncateValues,
        depth + 1,
      );
    }
    return result;
  }
  if (typeof obj === "string") {
    return truncateValues ? truncateString(obj) : obj;
  }
  return obj;
}
