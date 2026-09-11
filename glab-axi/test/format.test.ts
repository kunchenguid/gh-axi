import { describe, it, expect } from "vitest";
import { formatCountLine } from "../src/format.js";

describe("formatCountLine", () => {
  it("simple count", () => {
    expect(formatCountLine({ count: 3 })).toBe("count: 3");
  });

  it("count with a known total", () => {
    expect(formatCountLine({ count: 3, totalCount: 10 })).toBe(
      "count: 3 of 10 total",
    );
  });

  it("ignores a total smaller than the on-screen count (stale total)", () => {
    expect(formatCountLine({ count: 5, totalCount: 3 })).toBe("count: 5");
  });

  it("limit-truncated page", () => {
    expect(formatCountLine({ count: 30, limit: 30 })).toBe(
      "count: 30 (showing first 30)",
    );
  });

  it("short page under the limit is a plain count", () => {
    expect(formatCountLine({ count: 4, limit: 30 })).toBe("count: 4");
  });

  it("display limit truncation", () => {
    expect(formatCountLine({ count: 20, displayLimit: 10 })).toBe(
      "count: 20 (showing first 10)",
    );
  });

  it("zero count stays plain", () => {
    expect(formatCountLine({ count: 0, limit: 30 })).toBe("count: 0");
  });
});
