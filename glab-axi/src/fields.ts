import { AxiError } from "./errors.js";
import type { FieldDef } from "./toon.js";

/**
 * Resolve --fields extra columns. glab has no field selector — the JSON comes
 * back complete — so extras only extend the output schema.
 */
export function collectExtraFields(
  fieldsArg: string | undefined,
  extras: Record<string, FieldDef>,
): FieldDef[] {
  if (!fieldsArg) return [];
  const extraDefs: FieldDef[] = [];
  for (const raw of fieldsArg.split(",")) {
    const name = raw.trim();
    if (name === "") continue;
    const def = extras[name];
    if (!def) {
      throw new AxiError(
        `Unknown --fields entry: ${name}. Available: ${Object.keys(extras).join(", ")}`,
        "VALIDATION_ERROR",
      );
    }
    extraDefs.push(def);
  }
  return extraDefs;
}

/**
 * Exact state value from glab JSON, or undefined when absent or of an
 * unexpected shape. State matching accepts exact values only (e.g. exactly
 * `merged`), never a substring, so an output-format change degrades to
 * silence, not a false positive.
 */
export function exactState(item: unknown): string | undefined {
  const state = (item as { state?: unknown } | null | undefined)?.state;
  return typeof state === "string" && state.trim() !== ""
    ? state.trim().toLowerCase()
    : undefined;
}
