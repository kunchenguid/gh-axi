import { encode } from "@toon-format/toon";
import { isStdinTTY } from "../stdin.js";
import { runGitignorePreflight } from "../gitignore-hygiene.js";
import { AxiError } from "../errors.js";

export const HYGIENE_HELP = `usage: gh-axi hygiene [flags]
flags:
  --fix-ignore-conflicts  repair eligible tracked files matched by repository .gitignore
notes:
  default is report-only; TTY offers one all-match prompt
  non-TTY requires --fix-ignore-conflicts; local files are preserved
  global excludes and .git/info/exclude are never repaired`;

export async function hygieneCommand(args: string[]): Promise<string> {
  if (args.includes("--help") || args.includes("-h")) return HYGIENE_HELP;
  const unknown = args.filter((arg) => arg !== "--fix-ignore-conflicts");
  if (unknown.length > 0)
    throw new AxiError(
      `unknown flag for gh-axi hygiene: ${unknown[0]}`,
      "VALIDATION_ERROR",
    );
  const explicit = args.includes("--fix-ignore-conflicts");
  const result = await runGitignorePreflight({
    policy: explicit ? "explicit-fix" : isStdinTTY() ? "interactive" : "report",
  });
  return encode({
    hygiene: {
      git_available: result.gitAvailable,
      action: result.action,
      local_files: "preserved",
      findings: result.findings,
      push_preflight:
        "shared preflight boundary available; gh-axi has no push command",
    },
  });
}
