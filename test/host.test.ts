import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_HOST, escapeRegExp, resolveHost } from "../src/host.js";

describe("resolveHost", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env["GH_HOST"];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("defaults to github.com when nothing is configured", () => {
    expect(resolveHost()).toBe(DEFAULT_HOST);
    expect(resolveHost()).toBe("github.com");
  });

  it("honors the GH_HOST env var", () => {
    process.env["GH_HOST"] = "git.example.com";
    expect(resolveHost()).toBe("git.example.com");
  });

  it("lets an explicit flag value win over GH_HOST", () => {
    process.env["GH_HOST"] = "env.example.com";
    expect(resolveHost("flag.example.com")).toBe("flag.example.com");
  });

  it("uses the flag value when GH_HOST is unset", () => {
    expect(resolveHost("ghe.example.com")).toBe("ghe.example.com");
  });

  it("treats an empty flag value as unset and falls back", () => {
    process.env["GH_HOST"] = "env.example.com";
    expect(resolveHost("")).toBe("env.example.com");
  });
});

describe("escapeRegExp", () => {
  it("escapes regex metacharacters such as dots", () => {
    const pattern = new RegExp(escapeRegExp("git.example.com"));
    expect(pattern.test("git.example.com")).toBe(true);
    // The dot must be literal, not a wildcard.
    expect(pattern.test("gitxexamplexcom")).toBe(false);
  });
});
