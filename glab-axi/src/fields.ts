import { AxiError } from "./errors.js";
import type { FieldDef } from "./toon.js";

/**
 * Describes an extra column that can be requested via --fields.
 * `jsonKey` names the glab JSON field the column reads.
 * `def` is the FieldDef used to extract and format the value.
 */
export interface ExtraFieldSpec {
  jsonKey: string;
  def: FieldDef;
}

/**
 * Resolve --fields extra columns. glab has no field selector — the JSON comes
 * back complete — so extras only extend the output schema.
 */
export function collectExtraFields(
  fieldsArg: string | undefined,
  extras: Record<string, ExtraFieldSpec>,
): FieldDef[] {
  if (!fieldsArg) return [];
  const extraDefs: FieldDef[] = [];
  for (const raw of fieldsArg.split(",")) {
    const name = raw.trim();
    if (name === "") continue;
    const spec = extras[name];
    if (!spec) {
      throw new AxiError(
        `Unknown --fields entry: ${name}. Available: ${Object.keys(extras).join(", ")}`,
        "VALIDATION_ERROR",
      );
    }
    extraDefs.push(spec.def);
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
