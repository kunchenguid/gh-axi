import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { takeDescription, truncateBody } from "../src/body.js";
import { AxiError } from "../src/errors.js";

describe("takeDescription", () => {
  it("reads --description inline text (space form)", () => {
    const args = ["--description", "Body text", "--label", "bug"];
    expect(takeDescription(args)).toBe("Body text");
    expect(args).toEqual(["--label", "bug"]);
  });

  it("reads --description=value", () => {
    expect(takeDescription(["--description=Inline"])).toBe("Inline");
  });

  it("reads --description-file content", async () => {
    const dir = mkdtempSync(join(tmpdir(), "glab-axi-body-"));
    try {
      const file = join(dir, "body.md");
      writeFileSync(file, "# From file", "utf8");
      expect(takeDescription(["--description-file", file])).toBe("# From file");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects giving both description sources", async () => {
    const dir = mkdtempSync(join(tmpdir(), "glab-axi-body-"));
    try {
      const file = join(dir, "body.md");
      writeFileSync(file, "x", "utf8");
      expect(() =>
        takeDescription(["--description", "a", "--description-file", file]),
      ).toThrow(/not both/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws a VALIDATION_ERROR for a missing file", () => {
    try {
      takeDescription(["--description-file", "/nope/missing.md"]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AxiError);
      expect((error as AxiError).code).toBe("VALIDATION_ERROR");
      expect((error as AxiError).message).toContain("/nope/missing.md");
    }
  });

  it("returns undefined when no description flag is present", () => {
    expect(takeDescription(["--label", "bug"])).toBeUndefined();
  });

  it('rejects --description=- instead of letting glab open an editor', () => {
    expect(() => takeDescription(["--description=-"])).toThrow(
      /interactive editor/,
    );
  });

  it('rejects a --description-file whose whole content is "-"', () => {
    const dir = mkdtempSync(join(tmpdir(), "glab-axi-body-"));
    try {
      const file = join(dir, "body.md");
      writeFileSync(file, "-", "utf8");
      expect(() => takeDescription(["--description-file", file])).toThrow(
        /interactive editor/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("truncateBody", () => {
  it("passes short bodies through", () => {
    expect(truncateBody("short", 500)).toBe("short");
  });

  it("truncates long bodies with a --full hint", () => {
    const out = truncateBody("x".repeat(600), 500);
    expect(out).toContain("... (truncated, use --full)");
    expect(out.startsWith("x".repeat(500))).toBe(true);
  });

  it("normalizes missing or non-string bodies to empty string", () => {
    expect(truncateBody(undefined, 500)).toBe("");
    expect(truncateBody(null, 500)).toBe("");
    expect(truncateBody("", 500)).toBe("");
  });
});
