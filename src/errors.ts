import { AxiError, exitCodeForError } from "axi-sdk-js";

export type ErrorCode =
  | "REPO_NOT_FOUND"
  | "NOT_FOUND"
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "GH_NOT_INSTALLED"
  | "UNKNOWN";

export { AxiError, exitCodeForError };

interface ErrorPattern {
  pattern: RegExp;
  code: ErrorCode;
  message: (match: RegExpMatchArray, stderr: string) => string;
  suggestions?: (match: RegExpMatchArray) => string[];
}

const patterns: ErrorPattern[] = [
  {
    pattern: /Could not resolve to a Repository with the name '([^']+)'/,
    code: "REPO_NOT_FOUND",
    message: (m) => `Repository "${m[1]}" not found`,
    suggestions: () => ["Run `gh-axi repo list` to see your repositories"],
  },
  {
    pattern: /Could not resolve to an? .+? with the number of (\d+)/,
    code: "NOT_FOUND",
    message: (m) => `Item #${m[1]} does not exist in this repository`,
    suggestions: () => [],
  },
  {
    pattern: /issue (\d+) not found/i,
    code: "NOT_FOUND",
    message: (m) => `Issue #${m[1]} does not exist`,
    suggestions: () => [],
  },
  {
    pattern: /pull request (\d+) not found/i,
    code: "NOT_FOUND",
    message: (m) => `Pull request #${m[1]} does not exist`,
    suggestions: () => [],
  },
  {
    pattern: /release with tag "([^"]+)" not found/i,
    code: "NOT_FOUND",
    message: (m) => `Release "${m[1]}" not found`,
    suggestions: () => [
      `Run \`gh-axi release list\` to see available releases`,
    ],
  },
  {
    pattern: /run (\d+) not found/i,
    code: "NOT_FOUND",
    message: (m) => `Run ${m[1]} not found`,
    suggestions: () => [`Run \`gh-axi run list\` to see recent runs`],
  },
  {
    pattern: /gh auth login/,
    code: "AUTH_REQUIRED",
    message: () => "GitHub auth required — run `gh auth login` first",
  },
  {
    pattern: /secondary rate limit/i,
    code: "RATE_LIMITED",
    message: () => "GitHub secondary rate limit hit — wait ~60s and retry",
    suggestions: () => [
      "Wait 60s before retrying",
      "Use `gh api` (REST) for read-only ops, which has a separate budget",
    ],
  },
  {
    pattern: /API rate limit (?:already )?exceeded/i,
    code: "RATE_LIMITED",
    message: () => "GitHub API rate limit exceeded",
    suggestions: () => [
      "Wait until the hourly window resets (run `gh api rate_limit` to check)",
      "Use a different identity with `gh auth switch` if available",
    ],
  },
  {
    pattern: /HTTP 403/,
    code: "FORBIDDEN",
    message: () => "Insufficient permissions for this action",
  },
  {
    pattern: /HTTP 422/,
    code: "VALIDATION_ERROR",
    message: (_m, stderr) => {
      // Try to extract a meaningful message from the 422 body
      const msgMatch = stderr.match(/"message"\s*:\s*"([^"]+)"/);
      return msgMatch ? msgMatch[1] : "Validation error";
    },
  },
];

function firstErrorLine(stderr: string): string {
  return stderr.trim().split("\n")[0] ?? "";
}

export function mapGhError(stderr: string, exitCode: number): AxiError {
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
    firstErrorLine(stderr) || `gh exited with code ${exitCode}`,
    "UNKNOWN",
  );
}

export function ghNotInstalledError(): AxiError {
  return new AxiError(
    "gh CLI is not installed — see https://cli.github.com",
    "GH_NOT_INSTALLED",
  );
}
