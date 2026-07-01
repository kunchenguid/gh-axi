import { AxiError } from "./errors.js";
import { readStdin, isStdinTTY } from "./stdin.js";

/**
 * Resolve a secret/variable value from an already-extracted --body/-b flag,
 * or from piped stdin — matching `gh secret set` / `gh variable set` semantics.
 * Never accepts an interactive TTY prompt (AXI commands must not block on input).
 */
export async function resolveValue(
  flagValue: string | undefined,
  noun: "secret" | "variable",
): Promise<string> {
  if (flagValue !== undefined) {
    if (flagValue.length === 0) {
      throw new AxiError(`--body requires a value`, "VALIDATION_ERROR", [
        `gh-axi ${noun} set <name> --body <value>`,
      ]);
    }
    return flagValue;
  }

  if (isStdinTTY()) {
    throw new AxiError(
      `${noun} value is required: pass --body <value> or pipe the value via stdin`,
      "VALIDATION_ERROR",
      [
        `gh-axi ${noun} set <name> --body <value>`,
        `echo -n "<value>" | gh-axi ${noun} set <name>`,
      ],
    );
  }

  const value = await readStdin();
  if (value.length === 0) {
    throw new AxiError(
      `${noun} value is required: pass --body <value> or pipe the value via stdin`,
      "VALIDATION_ERROR",
    );
  }
  return value;
}
