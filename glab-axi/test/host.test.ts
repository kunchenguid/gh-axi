import { describe, it, expect } from "vitest";
import { resolveHost, escapeRegExp, DEFAULT_HOST } from "../src/host.js";

describe("resolveHost", () => {
  it("defaults to gitlab.com", () => {
    delete process.env["GITLAB_HOST"];
    expect(resolveHost()).toBe(DEFAULT_HOST);
    expect(DEFAULT_HOST).toBe("gitlab.com");
  });

  it("prefers an explicit flag over the env var", () => {
    process.env["GITLAB_HOST"] = "env.example.com";
    expect(resolveHost("flag.example.com")).toBe("flag.example.com");
    delete process.env["GITLAB_HOST"];
  });

  it("falls back to GITLAB_HOST", () => {
    process.env["GITLAB_HOST"] = "env.example.com";
    expect(resolveHost()).toBe("env.example.com");
    delete process.env["GITLAB_HOST"];
  });
});

describe("escapeRegExp", () => {
  it("escapes regex metacharacters so hosts embed literally", () => {
    expect(escapeRegExp("git.example.com")).toBe("git\\.example\\.com");
  });
});
