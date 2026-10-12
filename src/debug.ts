/**
 * `AXI_DEBUG=1` tracing of the argv gh-axi forwards to `gh`.
 *
 * The line goes to stderr only, so stdout (TOON) is unchanged. The part after
 * the `[axi-debug] ` prefix pastes into a shell as is, so a failing
 * gh-axi call can be retried in plain `gh` exactly as gh-axi ran it.
 */

export const DEBUG_PREFIX = "[axi-debug]";
export const MASK = "***";

const HEADER_FLAGS = new Set(["-H", "--header"]);
/** `gh api` flags that take the next token as their value, in separate form. */
const API_VALUE_FLAGS = new Set([
  "-X",
  "--method",
  "-f",
  "--raw-field",
  "-F",
  "--field",
  "-H",
  "--header",
  "-q",
  "--jq",
  "-t",
  "--template",
  "--input",
  "-p",
  "--preview",
  "--cache",
  "--hostname",
]);

/** True only when `AXI_DEBUG` is exactly `1`. */
export function debugEnabled(): boolean {
  return process.env["AXI_DEBUG"] === "1";
}

// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHAR = /[\x00-\x1f\x7f]/;
const ANSI_C_ESCAPES: Record<string, string> = {
  "\\": "\\\\",
  "'": "\\x27",
  "\n": "\\n",
  "\t": "\\t",
  "\r": "\\r",
};

/**
 * Quote an argument for a shell, only when it needs it. An argument with a
 * newline or other control character uses `$'...'` so the trace stays on one
 * physical line; everything else is POSIX single-quoted. `$'...'` replays
 * exactly in bash, zsh and POSIX.1-2024 sh. A quote inside it
 * is `\x27`, never a raw `'`, so an older sh reads it as one literal word and
 * cannot run any of its text as a command.
 */
export function shellQuote(arg: string): string {
  if (arg === "") return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg)) return arg;
  if (CONTROL_CHAR.test(arg)) {
    const body = arg.replace(
      // eslint-disable-next-line no-control-regex -- escapes control characters
      /[\\'\x00-\x1f\x7f]/g,
      (ch) =>
        ANSI_C_ESCAPES[ch] ??
        `\\x${ch.charCodeAt(0).toString(16).padStart(2, "0")}`,
    );
    return `$'${body}'`;
  }
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** Keep the header name, replace its value: `Authorization: ***`. */
function maskHeader(header: string): string {
  const colon = header.indexOf(":");
  if (colon === -1) return MASK;
  return `${header.slice(0, colon)}: ${MASK}`;
}

/**
 * For an `api` call, mask every `-H`/`--header` value, in the separate, `=`,
 * and attached (`-HAuthorization: ...`) forms. Values of other flags are
 * skipped, never read as flags. `api` is the only command that
 * forwards headers, the one place a credential can reach argv; secret values
 * are stdin-only and never appear there. Other commands are returned as is.
 */
export function maskSecrets(args: readonly string[]): string[] {
  if (args[0] !== "api") return [...args];
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (API_VALUE_FLAGS.has(arg) && i + 1 < args.length) {
      const value = args[i + 1];
      out.push(arg, HEADER_FLAGS.has(arg) ? maskHeader(value) : value);
      i++;
      continue;
    }
    if (arg.startsWith("--header=")) {
      out.push(`--header=${maskHeader(arg.slice("--header=".length))}`);
      continue;
    }
    if (arg.startsWith("-H") && arg.length > 2 && !arg.startsWith("--")) {
      const value = arg.slice(arg[2] === "=" ? 3 : 2);
      out.push(`-H${maskHeader(value)}`);
      continue;
    }
    out.push(arg);
  }
  return out;
}

/** Format the debug line (without trailing newline) for a `gh` call. */
export function formatDebugLine(args: readonly string[]): string {
  return [DEBUG_PREFIX, "gh", ...maskSecrets(args).map(shellQuote)].join(" ");
}

/** Write the debug line to stderr when `AXI_DEBUG=1`; otherwise do nothing. */
export function debugArgv(args: readonly string[]): void {
  if (!debugEnabled()) return;
  process.stderr.write(`${formatDebugLine(args)}\n`);
}
