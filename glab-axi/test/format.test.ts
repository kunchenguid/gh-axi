import { describe, it, expect } from "vitest";
import { formatCountLine, resolveLimit } from "../src/format.js";

describe("resolveLimit", () => {
  it("defaults to 30 when --limit is omitted", () => {
    expect(resolveLimit(undefined)).toBe(30);
  });

  it("keeps a limit within GitLab's page cap", () => {
    expect(resolveLimit("5")).toBe(5);
    expect(resolveLimit("100")).toBe(100);
  });

  it("clamps a limit above GitLab's page cap", () => {
    expect(resolveLimit("500")).toBe(100);
  });

  it("rejects a non-positive or non-numeric limit", () => {
    expect(() => resolveLimit("0")).toThrow(/Invalid --limit value/);
    expect(() => resolveLimit("abc")).toThrow(/Invalid --limit value/);
  });
});

describe("formatCountLine", () => {
  it("simple count", () => {
    expect(formatCountLine({ count: 3 })).toBe("count: 3");
  });

  it("limit-truncated page", () => {
    expect(formatCountLine({ count: 30, limit: 30 })).toBe(
      "count: 30 (showing first 30)",
    );
  });

  it("short page under the limit is a plain count", () => {
    expect(formatCountLine({ count: 4, limit: 30 })).toBe("count: 4");
  });

  it("zero count stays plain", () => {
    expect(formatCountLine({ count: 0, limit: 30 })).toBe("count: 0");
  });
});
