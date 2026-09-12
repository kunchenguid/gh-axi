import { AxiError } from "./errors.js";

function flagEqualsPrefix(flag: string): string {
  return `${flag}=`;
}

/**
 * Check if a boolean flag is present and remove it from args.
 *
 * A `--flag=value` spelling is rejected rather than ignored: matching whole
 * tokens only would drop it without a word, and rejectUnknownFlags compares
 * the flag name with any `=value` stripped, so nothing else would catch it.
 */
export function takeBoolFlag(args: string[], flag: string): boolean {
  const equalsPrefix = flagEqualsPrefix(flag);
  const valued = args.find((arg) => arg.startsWith(equalsPrefix));
  if (valued !== undefined) {
    throw new AxiError(
      `${valued}: use ${flag} alone (boolean flags do not take a value)`,
      "VALIDATION_ERROR",
    );
  }
  const idx = args.indexOf(flag);
  if (idx === -1) return false;
  args.splice(idx, 1);
  return true;
}

/** A token that reads as another option (`-R`, `--title`), not as a value. */
function isFlagShaped(token: string): boolean {
  return /^--?[A-Za-z]/.test(token);
}

function requireFlagValue(value: string, flag: string): string {
  if (value.trim() === "")
    throw new AxiError(`${flag} requires a value`, "VALIDATION_ERROR");
  return value;
}

/**
 * Read a flag's value from --flag value or --flag=value, remove it from args,
 * and throw VALIDATION_ERROR when the flag is present with a missing or blank
 * value rather than silently returning undefined for it.
 *
 * A following flag-shaped token (`--source --push`) is treated as a missing
 * value, not consumed as one. Only flag-shaped tokens count: a bulleted
 * markdown body ("- fixes the redirect") or a value like "-1 regression" is
 * ordinary text and is taken as the value.
 */
export function takeRequiredFlag(
  args: string[],
  flag: string,
): string | undefined {
  const equalsPrefix = flagEqualsPrefix(flag);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === flag) {
      const val = args[i + 1];
      if (val === undefined || isFlagShaped(val))
        throw new AxiError(`${flag} requires a value`, "VALIDATION_ERROR");
      args.splice(i, 2);
      return requireFlagValue(val, flag);
    }
    if (arg.startsWith(equalsPrefix)) {
      args.splice(i, 1);
      return requireFlagValue(arg.slice(equalsPrefix.length), flag);
    }
  }
  return undefined;
}

function collectAllFlags(args: string[], flag: string): string[] {
  const result: string[] = [];
  const equalsPrefix = flagEqualsPrefix(flag);
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === flag) {
      const val = args[i + 1];
      if (val === undefined || isFlagShaped(val))
        throw new AxiError(`${flag} requires a value`, "VALIDATION_ERROR");
      result.push(requireFlagValue(val, flag));
      args.splice(i, 2);
    } else if (arg.startsWith(equalsPrefix)) {
      result.push(requireFlagValue(arg.slice(equalsPrefix.length), flag));
      args.splice(i, 1);
    } else {
      i++;
    }
  }
  return result;
}

/**
 * Collect every value for a repeatable flag in --flag value or --flag=value
 * form and remove each occurrence from args. Throws VALIDATION_ERROR if any
 * occurrence has a missing or blank value, rather than silently dropping it;
 * a following flag-shaped token is a missing value, not the flag's value.
 */
export function takeAllFlags(args: string[], flag: string): string[] {
  return collectAllFlags(args, flag);
}

/** Append a repeatable flag once per value onto a glab argv array. */
export function pushRepeated(
  glabArgs: string[],
  flag: string,
  values: string[],
): void {
  for (const value of values) glabArgs.push(flag, value);
}

/**
 * The one positional argument a subcommand takes, or undefined when absent.
 *
 * A surplus positional throws: `mr close 42 43` would otherwise close only
 * !42, applying the mutation to fewer entities than the caller asked for.
 * Call it after the subcommand's value flags have been consumed, so only
 * genuine positionals remain.
 */
export function onlyPositional(
  args: string[],
  startIndex: number,
  label: string,
): string | undefined {
  const positionals = remainingPositionals(args, startIndex);
  if (positionals.length > 1) {
    throw new AxiError(
      `Too many arguments for ${label}: expected one number, got ${positionals.join(", ")}`,
      "VALIDATION_ERROR",
    );
  }
  return positionals[0];
}

/**
 * Reject every positional a subcommand that takes none was given. Call it
 * once the subcommand's flags have been consumed, so only stray tokens are
 * left: `mr list closed` would otherwise return the default opened set.
 */
export function rejectPositionals(
  args: string[],
  startIndex: number,
  label: string,
): void {
  const positionals = remainingPositionals(args, startIndex);
  if (positionals.length > 0) {
    throw new AxiError(
      `Unexpected argument for ${label}: ${positionals.join(", ")}. This subcommand takes flags only`,
      "VALIDATION_ERROR",
    );
  }
}

function remainingPositionals(args: string[], startIndex: number): string[] {
  return args.slice(startIndex).filter((a) => !isFlagShaped(a));
}

/** Parse and validate a required numeric argument. */
export function requireNumber(raw: string | undefined, label: string): number {
  if (!raw) throw new AxiError(`Missing ${label} number`, "VALIDATION_ERROR");
  if (!/^\d+$/.test(raw))
    throw new AxiError(`Invalid ${label} number: ${raw}`, "VALIDATION_ERROR");
  return Number(raw);
}

/**
 * Reject flags in `args` that are not listed in `known`, after the subcommand
 * has parsed the flags it recognizes. Positionals and `--help`/`-h` always
 * pass; `--` ends flag scanning. Value forms (`--flag=v`) are matched by flag
 * name only. Throws VALIDATION_ERROR listing every offending flag plus a
 * one-turn self-correction hint (usage + `--help`), per AXI principle 6:
 * never silently drop an unknown flag.
 */
export function rejectUnknownFlags(
  args: string[],
  known: readonly string[],
  command: string,
  sub: string,
): void {
  const knownSet = new Set(known);
  const unknown: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const tok = args[i];
    if (tok === "--") break;
    if (!isFlagShaped(tok)) continue;
    const name = tok.split("=", 1)[0];
    if (name === "--help" || name === "-h") continue;
    if (knownSet.has(name)) continue;
    if (!unknown.includes(name)) unknown.push(name);
  }
  if (unknown.length === 0) return;
  const list = unknown.join(", ");
  throw new AxiError(
    `unknown flag${unknown.length > 1 ? "s" : ""} for glab-axi ${command} ${sub}: ${list}`,
    "VALIDATION_ERROR",
    [`glab-axi ${command} ${sub} [flags]`, `glab-axi ${command} ${sub} --help`],
  );
}
