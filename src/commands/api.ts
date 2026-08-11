import { encode } from '@toon-format/toon';
import type { RepoContext } from '../context.js';
import { ghExec } from '../gh.js';
import { AxiError } from '../errors.js';
import { cleanBody } from '../body.js';

export const API_HELP = `usage: gh-axi api [<method>] <path>
description: Make an authenticated GitHub API request. Defaults to GET if no method specified.
methods[6]:
  GET, POST, PUT, PATCH, DELETE, HEAD
flags[6]:
  --field <key=value> (repeatable), --header <key:value> (repeatable), --paginate, --jq <expression>, --template <format>, --full (preserve complete field values and response bodies without truncation)
examples:
  gh-axi api /repos/{owner}/{repo}
  gh-axi api POST /repos/{owner}/{repo}/issues --field title="Bug report"
  gh-axi api /repos/{owner}/{repo}/pulls --paginate
  gh-axi api /repos/{owner}/{repo}/issues/1 --jq '[.labels[].name]'`;

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);

/** Value flags that may be given more than once, each occurrence forwarded to gh. */
const REPEATABLE_VALUE_FLAGS = new Set(['--field', '--header']);

/** Value flags that gh accepts only one of, so a repeat is a caller mistake. */
const SINGLE_VALUE_FLAGS = new Set(['--jq', '--template']);

/** Flags that stand alone and must not consume the following argument, and are forwarded to gh. */
const BOOL_FLAGS = new Set(['--paginate']);

/** Flags that stand alone, are gh-axi-only, and must not be forwarded to gh. */
const LOCAL_BOOL_FLAGS = new Set(['--full']);

const SUPPORTED_FLAGS = [
  ...REPEATABLE_VALUE_FLAGS,
  ...SINGLE_VALUE_FLAGS,
  ...BOOL_FLAGS,
  ...LOCAL_BOOL_FLAGS,
];

/** The flag's name without any `=value` suffix, so errors never echo a value. */
function flagName(arg: string): string {
  const equals = arg.indexOf('=');
  return equals === -1 ? arg : arg.slice(0, equals);
}

interface ParsedApiArgs {
  positionals: string[];
  fields: string[];
  headers: string[];
  jq?: string;
  template?: string;
  paginate: boolean;
  full: boolean;
}

/**
 * Walk args once, collecting positionals and flag values and rejecting anything
 * unrecognised.
 *
 * Unknown flags used to be skipped along with the following argument, so a flag
 * `gh-axi api` did not implement — `--jq` above all — silently vanished together
 * with its value and the caller got an unfiltered response that looked plausible.
 * Only flags known to take a value consume the next argument, which also keeps
 * `--paginate <path>` from swallowing the path.
 *
 * This single pass is also the only place that decides which flags consume a
 * value: re-scanning args afterwards gave a second, value-blind notion of the
 * same thing, so `--header --jq=.x` both consumed `--jq=.x` as the header value
 * and forwarded it as a jq expression.
 */
function parseArgs(args: string[]): ParsedApiArgs {
  const parsed: ParsedApiArgs = {
    positionals: [],
    fields: [],
    headers: [],
    paginate: false,
    full: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('-')) {
      parsed.positionals.push(arg);
      continue;
    }
    const name = flagName(arg);
    if (BOOL_FLAGS.has(name)) {
      if (name !== arg)
        throw new AxiError(`${name} does not take a value`, 'VALIDATION_ERROR');
      parsed.paginate = true;
      continue;
    }
    if (LOCAL_BOOL_FLAGS.has(name)) {
      if (name !== arg)
        throw new AxiError(`${name} does not take a value`, 'VALIDATION_ERROR');
      parsed.full = true;
      continue;
    }
    if (!REPEATABLE_VALUE_FLAGS.has(name) && !SINGLE_VALUE_FLAGS.has(name)) {
      throw new AxiError(
        `unknown flag ${name} for gh-axi api. Supported flags: ${SUPPORTED_FLAGS.join(', ')}`,
        'VALIDATION_ERROR',
      );
    }
    // `--flag=value` carries its own value; `--flag value` consumes the next arg.
    let value: string;
    if (name === arg) {
      if (i + 1 >= args.length)
        throw new AxiError(`${name} requires a value`, 'VALIDATION_ERROR');
      value = args[++i];
    } else {
      value = arg.slice(name.length + 1);
    }
    if (name === '--field') {
      parsed.fields.push(value);
    } else if (name === '--header') {
      parsed.headers.push(value);
    } else {
      // gh takes the last occurrence; discarding the earlier expression silently
      // is the same failure this parser exists to prevent, so reject instead.
      const key = name === '--jq' ? 'jq' : 'template';
      if (parsed[key] !== undefined)
        throw new AxiError(`${name} may only be given once`, 'VALIDATION_ERROR');
      // An empty value (an unset shell variable) is a no-op filter for gh that
      // would still suppress the default field stripping here.
      if (value.trim() === '')
        throw new AxiError(`${name} requires a value`, 'VALIDATION_ERROR');
      parsed[key] = value;
    }
  }
  return parsed;
}

/** Maximum length for raw (non-JSON) API output before truncation. */
const RAW_OUTPUT_TRUNCATION_LIMIT = 4000;

/** Strings longer than this threshold are cleaned up (image/URL stripping). */
const LONG_STRING_CLEANUP_THRESHOLD = 200;

/** Maximum length for cleaned string values before truncation. */
const STRING_VALUE_TRUNCATION_LIMIT = 2000;


export async function apiCommand(args: string[], ctx?: RepoContext): Promise<string> {
  if (args[0] === '--help' || args.length === 0) return API_HELP;

  const { positionals, fields, headers, jq, template, paginate, full } =
    parseArgs(args);

  const pathRequired = new AxiError(
    'API path is required: gh-axi api [<method>] <path>',
    'VALIDATION_ERROR',
  );
  if (positionals.length === 0) throw pathRequired;

  // A positional the command cannot place is a caller typo, and dropping it
  // silently requests a different endpoint than the one that was asked for.
  const methodGiven = HTTP_METHODS.has(positionals[0].toUpperCase());
  if (positionals.length > (methodGiven ? 2 : 1)) {
    throw new AxiError(
      'too many arguments for gh-axi api: expected [<method>] <path>',
      'VALIDATION_ERROR',
    );
  }
  if (methodGiven && positionals.length < 2) throw pathRequired;

  const method = methodGiven ? positionals[0].toUpperCase() : 'GET';
  const path = methodGiven ? positionals[1] : positionals[0];

  const ghArgs = ['api', path, '--method', method];

  for (const f of fields) {
    ghArgs.push('--field', f);
  }

  for (const h of headers) {
    ghArgs.push('--header', h);
  }

  if (paginate) ghArgs.push('--paginate');

  if (jq !== undefined) ghArgs.push('--jq', jq);

  if (template !== undefined) ghArgs.push('--template', template);

  // A caller who wrote a jq expression or template already chose the exact shape
  // they want, so noisy-field stripping would silently delete fields they asked
  // for by name (`url`, `node_id`, ...). The length clamp still applies, so a
  // selected field cannot blow the caller's context with an unbounded blob.
  const callerShapedOutput = jq !== undefined || template !== undefined;

  // --full is an explicit opt-in escape hatch: it keeps every field (like
  // caller-shaped output) and additionally lifts the string-length clamp, so
  // compact output stays the default everywhere --full is not given.
  const stripNoisyKeys = !callerShapedOutput && !full;
  const truncateValues = !full;

  // Try to parse as JSON, strip noisy fields, encode to TOON; fall back to raw output
  const raw = await ghExec(ghArgs, ctx);
  try {
    const data = JSON.parse(raw);
    return encode(shapeOutput(data, stripNoisyKeys, truncateValues));
  } catch {
    // Not JSON — wrap in TOON envelope with truncation metadata
    const trimmed = raw.trim();
    const truncated = !full && trimmed.length > RAW_OUTPUT_TRUNCATION_LIMIT;
    const result: Record<string, unknown> = {
      api_response: {
        body: truncated ? trimmed.slice(0, RAW_OUTPUT_TRUNCATION_LIMIT) : trimmed,
        truncated,
      },
    };
    if (truncated) {
      (result.api_response as Record<string, unknown>).original_length = trimmed.length;
    }
    return encode(result);
  }
}

/** Fields from raw GitHub API responses that are noisy/useless for agents */
const NOISY_KEYS = new Set([
  'avatar_url', 'gravatar_id', 'followers_url', 'following_url',
  'gists_url', 'starred_url', 'subscriptions_url', 'organizations_url',
  'repos_url', 'events_url', 'received_events_url', 'labels_url',
  'comments_url', 'events_url', 'timeline_url', 'performed_via_github_app',
  'node_id', 'url', 'repository_url', 'html_url',
  'reactions', 'user_view_type', 'site_admin',
  'issue_dependencies_summary', 'sub_issues_summary', 'pinned_comment',
  'score', 'permissions', 'verification', '_links',
]);

/** Keys ending in _url that are template URLs agents never use */
function isTemplateUrlKey(key: string): boolean {
  if (!key.endsWith('_url')) return false;
  // Keep a few meaningful URL keys
  const KEEP_URL_KEYS = new Set([
    'diff_url', 'patch_url', 'clone_url', 'ssh_url', 'git_url', 'svn_url',
    'commit_url', // useful for linking to specific commits
  ]);
  return !KEEP_URL_KEYS.has(key);
}

/** Collapse repo/repository objects to essential fields only */
function collapseRepo(obj: Record<string, unknown>): Record<string, unknown> {
  if ('full_name' in obj) {
    const collapsed: Record<string, unknown> = { full_name: obj.full_name };
    if (obj.default_branch) collapsed.default_branch = obj.default_branch;
    if (obj.private) collapsed.private = obj.private;
    return collapsed;
  }
  return obj;
}

/** Bound a string value's length, leaving its content untouched. */
function truncateString(value: string): string {
  if (value.length <= STRING_VALUE_TRUNCATION_LIMIT) return value;
  return value.slice(0, STRING_VALUE_TRUNCATION_LIMIT) + '... (truncated)';
}

/** Clean and truncate a long string value (e.g. bodies, comments, blobs). */
function clampString(value: string): string {
  if (value.length <= LONG_STRING_CLEANUP_THRESHOLD) return value;
  return truncateString(cleanBody(value));
}

/**
 * Walk a decoded API response, bounding every string value.
 *
 * With `stripNoisyKeys` the noisy keys are dropped and long strings are cleaned
 * as well. Output the caller shaped with --jq/--template keeps both its keys and
 * its content verbatim and is only length-bounded, since rewriting a field they
 * selected by name is the same silent mutation as deleting it. With
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
  if (obj !== null && typeof obj === 'object') {
    const record = obj as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (!stripNoisyKeys) {
        result[key] = shapeOutput(value, stripNoisyKeys, truncateValues, depth + 1);
        continue;
      }
      if (NOISY_KEYS.has(key)) continue;
      if (isTemplateUrlKey(key)) continue;
      // Strip nested user objects down to just login
      if (key === 'user' && value && typeof value === 'object' && 'login' in (value as Record<string, unknown>)) {
        result[key] = (value as Record<string, unknown>).login;
        continue;
      }
      // Collapse repo/repository objects to essential fields
      if ((key === 'repo' || key === 'repository') && value && typeof value === 'object') {
        result[key] = collapseRepo(value as Record<string, unknown>);
        continue;
      }
      result[key] = shapeOutput(value, stripNoisyKeys, truncateValues, depth + 1);
    }
    return result;
  }
  if (typeof obj === 'string') {
    if (!truncateValues) return obj;
    return stripNoisyKeys ? clampString(obj) : truncateString(obj);
  }
  return obj;
}
