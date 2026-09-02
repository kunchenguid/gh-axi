import { AxiError } from "./errors.js";

function flagEqualsPrefix(flag: string): string {
  return `${flag}=`;
}

/** Get a flag's value from --flag value or --flag=value without modifying args. */
export function getFlag(args: string[], name: string): string | undefined {
  const equalsPrefix = flagEqualsPrefix(name);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === name) {
      if (i + 1 >= args.length) return undefined;
      return args[i + 1];
    }
    if (arg.startsWith(equalsPrefix)) {
      return arg.slice(equalsPrefix.length);
    }
  }
  return undefined;
}

/** Get a flag's value from --flag value or --flag=value and remove it from args. */
export function takeFlag(args: string[], flag: string): string | undefined {
  const equalsPrefix = flagEqualsPrefix(flag);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === flag) {
      const val = args[i + 1];
      args.splice(i, 2);
      return val;
    }
    if (arg.startsWith(equalsPrefix)) {
      const val = arg.slice(equalsPrefix.length);
      args.splice(i, 1);
      return val;
    }
  }
  return undefined;
}

/** Check if a boolean flag is present. */
export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

/** Check if a boolean flag is present and remove it from args. */
export function takeBoolFlag(args: string[], flag: string): boolean {
  const idx = args.indexOf(flag);
  if (idx === -1) return false;
  args.splice(idx, 1);
  return true;
}

function requireFlagValue(value: string, flag: string): string {
  if (value.trim() === "")
    throw new AxiError(`${flag} requires a value`, "VALIDATION_ERROR");
  return value;
}

/**
 * Like takeFlag, but throws VALIDATION_ERROR when the flag is present with a
 * missing or blank value, rather than silently returning undefined for it.
 * A following option token (`--source --push`) is treated as a missing value,
 * not consumed as one; use `--flag=value` for a dash-leading value.
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
      if (val === undefined || val.startsWith("-"))
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

function collectAllFlags(
  args: string[],
  flag: string,
  consume: boolean,
): string[] {
  const result: string[] = [];
  const equalsPrefix = flagEqualsPrefix(flag);
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === flag) {
      result.push(requireFlagValue(args[i + 1] ?? "", flag));
      if (consume) args.splice(i, 2);
      else i += 2;
    } else if (arg.startsWith(equalsPrefix)) {
      result.push(requireFlagValue(arg.slice(equalsPrefix.length), flag));
      if (consume) args.splice(i, 1);
      else i++;
    } else {
      i++;
    }
  }
  return result;
}

/**
 * Collect all values for a repeatable flag in --flag value or --flag=value form
 * without modifying args. Throws VALIDATION_ERROR if any occurrence has a
 * missing or blank value, rather than silently dropping it.
 */
export function getAllFlags(args: string[], flag: string): string[] {
  return collectAllFlags(args, flag, false);
}

/** Like getAllFlags, but also removes every occurrence from args. */
export function takeAllFlags(args: string[], flag: string): string[] {
  return collectAllFlags(args, flag, true);
}

/** Append a repeatable flag once per value onto a gh argv array. */
export function pushRepeated(
  ghArgs: string[],
  flag: string,
  values: string[],
): void {
  for (const value of values) ghArgs.push(flag, value);
}

/** Get the first positional arg (non-flag) starting from startIndex. */
export function getPositional(
  args: string[],
  startIndex: number,
): string | undefined {
  for (let i = startIndex; i < args.length; i++) {
    if (!args[i].startsWith("--")) return args[i];
  }
  return undefined;
}

/** Parse and validate a required numeric argument. */
export function requireNumber(raw: string | undefined, label: string): number {
  if (!raw) throw new AxiError(`Missing ${label} number`, "VALIDATION_ERROR");
  const n = parseInt(raw, 10);
  if (isNaN(n))
    throw new AxiError(`Invalid ${label} number: ${raw}`, "VALIDATION_ERROR");
  return n;
}

/** Find the first numeric positional arg, remove it from args, and return it as a number. */
export function takeNumber(args: string[], label: string): number {
  const raw = args.find((a) => /^\d+$/.test(a));
  if (!raw) throw new AxiError(`Missing ${label} number`, "VALIDATION_ERROR");
  args.splice(args.indexOf(raw), 1);
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
    if (!tok.startsWith("-")) continue;
    const name = tok.split("=", 1)[0];
    if (name === "--help" || name === "-h") continue;
    if (knownSet.has(name)) continue;
    if (!unknown.includes(name)) unknown.push(name);
  }
  if (unknown.length === 0) return;
  const list = unknown.join(", ");
  throw new AxiError(
    `unknown flag${unknown.length > 1 ? "s" : ""} for gh-axi ${command} ${sub}: ${list}`,
    "VALIDATION_ERROR",
    [`gh-axi ${command} ${sub} [flags]`, `gh-axi ${command} ${sub} --help`],
  );
}
