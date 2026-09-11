/**
 * Shared formatting helpers for consistent count and truncation phrasing.
 *
 * Standard phrases:
 *   count: N                    — simple count
 *   count: N (showing first N)  — when truncated by limit
 */

import { AxiError } from "./errors.js";

/** Default number of list items requested when --limit is omitted. */
const DEFAULT_LIMIT = 30;

/**
 * GitLab caps per_page at 100 and silently clamps anything larger, so a bigger
 * --limit would make a truncated page look complete. Clamp it ourselves and
 * report the clamped value, so formatCountLine marks the page as truncated.
 */
export const MAX_LIMIT = 100;

export function resolveLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  const limit = Number.parseInt(raw, 10);
  if (!Number.isFinite(limit) || limit < 1) {
    throw new AxiError(
      `Invalid --limit value: ${raw}. Must be a positive integer`,
      "VALIDATION_ERROR",
    );
  }
  return Math.min(limit, MAX_LIMIT);
}

export interface CountLineOptions {
  /** Number of items returned / displayed. */
  count: number;
  /** The request limit; when count === limit, results may be truncated. */
  limit?: number;
}

export function formatCountLine(opts: CountLineOptions): string {
  const { count, limit } = opts;

  // Hit the request limit — results may be truncated
  if (limit !== undefined && count === limit && count > 0) {
    return `count: ${count} (showing first ${count})`;
  }

  return `count: ${count}`;
}
