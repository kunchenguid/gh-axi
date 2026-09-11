import { AxiError, exitCodeForError } from "axi-sdk-js";

export type ErrorCode =
  | "PROJECT_NOT_FOUND"
  | "NOT_FOUND"
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "GLAB_NOT_INSTALLED"
  | "UNKNOWN";

export { AxiError, exitCodeForError };

function firstErrorLine(stderr: string): string {
  // glab wraps some errors in a decorative banner: blank padding lines and a
  // lone "ERROR" heading. Skip those so the reported line is the message.
  for (const raw of stderr.trim().split("\n")) {
    const line = raw.trim();
    if (line === "" || line === "ERROR") continue;
    return line;
  }
  return "";
}

interface ErrorPattern {
  pattern: RegExp;
  code: ErrorCode;
  message: (match: RegExpMatchArray, stderr: string) => string;
  suggestions?: (match: RegExpMatchArray) => string[];
}

/**
 * Order is the contract: patterns are walked in order and the first hit wins,
 * so a narrow, specific pattern must sit ahead of any broader one it would
 * otherwise be swallowed by.
 *
 * Verified glab stderr shapes (glab 1.117.0):
 *   mr view:   "Failed to get merge request 999999: 404 Not Found."
 *   api:       "glab: 404 Project Not Found (HTTP 404)"
 */
const patterns: ErrorPattern[] = [
  {
    pattern: /404 Project Not Found/i,
    code: "PROJECT_NOT_FOUND",
    message: () => `Project not found (404)`,
    suggestions: () => [
      "Pass the full project path to -R, e.g. `-R group/subgroup/project` (after the command)",
      "For a self-hosted instance, add `--hostname <host>` or set GITLAB_HOST",
    ],
  },
  {
    pattern: /Failed to get merge request (\d+):\s*(.+)/i,
    code: "NOT_FOUND",
    message: (m) => `Merge request !${m[1]} not found in this project`,
    suggestions: () => [
      "Run `glab-axi mr list` to see open merge requests",
    ],
  },
  {
    pattern: /Failed to get issue (\d+):\s*(.+)/i,
    code: "NOT_FOUND",
    message: (m) => `Issue #${m[1]} not found in this project`,
    suggestions: () => [
      "Run `glab-axi issue list` to see open issues",
    ],
  },
  {
    // glab rejects a -R value that is not [HOST/]OWNER/[NAMESPACE/]REPO before
    // any request goes out; must sit ahead of the generic 404 patterns.
    pattern: /Expected the "\[HOST\/\]OWNER\/\[NAMESPACE\/\]REPO" format/i,
    code: "VALIDATION_ERROR",
    message: () => "Invalid project selector",
    suggestions: () => [
      "Pass the full project path to -R, e.g. `-R group/subgroup/project` (after the command)",
    ],
  },
  {
    // list commands surface a bare 404 when the project is missing (no item
    // number to name); narrower item-404 patterns above take precedence.
    pattern: /404 (?:Project )?Not Found/i,
    code: "NOT_FOUND",
    message: () => "Not found in this project",
    suggestions: () => [
      "Check the project path: pass `-R group/subgroup/project` (after the command)",
    ],
  },
  {
    pattern: /401 Unauthorized/i,
    code: "AUTH_REQUIRED",
    message: () => "GitLab auth required — run `glab auth login` first",
  },
  {
    // glab prints a login hint when no account is configured for the host;
    // that is an auth problem even when the wording differs from 401.
    pattern: /glab auth login/i,
    code: "AUTH_REQUIRED",
    message: () => "GitLab auth required — run `glab auth login` first",
  },
  {
    pattern: /403 Forbidden/i,
    code: "FORBIDDEN",
    message: () => "Insufficient permissions for this action",
  },
  {
    pattern: /429 Too Many Requests/i,
    code: "RATE_LIMITED",
    message: () => "GitLab rate limit hit — wait ~60s and retry",
    suggestions: () => [
      "Wait 60s before retrying",
    ],
  },
];

export function mapGlabError(stderr: string, exitCode: number): AxiError {
  for (const { pattern, code, message, suggestions } of patterns) {
    const match = stderr.match(pattern);
    if (match) {
      return new AxiError(
        message(match, stderr),
        code,
        suggestions?.(match) ?? [],
      );
    }
  }

  // Generic not-found for any 404-like message
  if (/not found/i.test(stderr)) {
    return new AxiError(firstErrorLine(stderr), "NOT_FOUND");
  }

  return new AxiError(
    firstErrorLine(stderr) || `glab exited with code ${exitCode}`,
    "UNKNOWN",
  );}

export function glabNotInstalledError(): AxiError {
  return new AxiError(
    "glab CLI is not installed — see https://gitlab.com/gitlab-org/cli",
    "GLAB_NOT_INSTALLED",
  );
}

export class MutationFollowupError extends AxiError {
  constructor(
    readonly mutationState: string,
    readonly followupError: AxiError,
  ) {
    super(
      `Mutation succeeded at ${mutationState}, but follow-up operation failed: ${followupError.message}`,
      followupError.code,
      [
        `Do not retry the mutation; inspect ${mutationState} before retrying the follow-up operation`,
        ...followupError.suggestions,
      ],
    );
    this.name = "MutationFollowupError";
  }

  static from(mutationState: string, error: unknown): MutationFollowupError {
    return new MutationFollowupError(
      mutationState,
      error instanceof AxiError
        ? error
        : new AxiError(
            error instanceof Error ? error.message : String(error),
            "UNKNOWN",
          ),
    );
  }
}
