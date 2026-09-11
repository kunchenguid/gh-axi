import { describe, it, expect } from "vitest";
import { mapGlabError, MutationFollowupError } from "../src/errors.js";
import { AxiError } from "../src/errors.js";

describe("mapGlabError", () => {
  it("maps a missing merge request", () => {
    const err = mapGlabError(
      "\n   ERROR  \n\n  Failed to get merge request 999999: 404 Not Found.\n",
      1,
    );
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("Merge request !999999 not found in this project");
    expect(err.suggestions).toContain(
      "Run `glab-axi mr list` to see open merge requests",
    );
  });

  it("maps a missing issue", () => {
    const err = mapGlabError("Failed to get issue 7: 404 Not Found.", 1);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("Issue #7 not found in this project");
  });

  it("maps a 404 Project Not Found from the api passthrough", () => {
    const err = mapGlabError("glab: 404 Project Not Found (HTTP 404)", 1);
    expect(err.code).toBe("PROJECT_NOT_FOUND");
    expect(err.suggestions.join(" ")).toContain("group/subgroup/project");
  });

  it("maps an invalid -R format ahead of the generic 404 patterns", () => {
    const err = mapGlabError(
      'Expected the "[HOST/]OWNER/[NAMESPACE/]REPO" format, got "nope.nope".',
      1,
    );
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toBe("Invalid project selector");
  });

  it("maps a bare 404 from list commands to NOT_FOUND", () => {
    const err = mapGlabError("\n   ERROR  \n\n  404 Not Found.\n", 1);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("Not found in this project");
  });

  it("maps 401 and login hints to AUTH_REQUIRED", () => {
    expect(mapGlabError("glab: 401 Unauthorized (HTTP 401)", 1).code).toBe(
      "AUTH_REQUIRED",
    );
    expect(
      mapGlabError("run `glab auth login` to authenticate", 1).code,
    ).toBe("AUTH_REQUIRED");
  });

  it("maps 403 to FORBIDDEN", () => {
    expect(mapGlabError("glab: 403 Forbidden (HTTP 403)", 1).code).toBe(
      "FORBIDDEN",
    );
  });

  it("maps 429 to RATE_LIMITED", () => {
    expect(mapGlabError("429 Too Many Requests", 1).code).toBe("RATE_LIMITED");
  });

  it("falls back to the first meaningful stderr line, skipping the banner", () => {
    const err = mapGlabError("\n   ERROR  \n\n  Something odd happened.\n", 1);
    expect(err.code).toBe("UNKNOWN");
    expect(err.message).toBe("Something odd happened.");
  });

  it("reports the exit code when stderr is empty", () => {
    const err = mapGlabError("", 3);
    expect(err.code).toBe("UNKNOWN");
    expect(err.message).toBe("glab exited with code 3");
  });
});

describe("MutationFollowupError", () => {
  it("wraps a follow-up failure and forbids retrying the mutation", () => {
    const err = MutationFollowupError.from(
      "https://gitlab.com/g/p/-/merge_requests/9",
      new AxiError("view blew up", "NOT_FOUND"),
    );
    expect(err.message).toContain("Mutation succeeded at");
    expect(err.message).toContain("view blew up");
    expect(err.code).toBe("NOT_FOUND");
    expect(err.suggestions[0]).toContain("Do not retry the mutation");
  });

  it("accepts non-AxiError causes", () => {
    const err = MutationFollowupError.from("state", new Error("raw"));
    expect(err.code).toBe("UNKNOWN");
    expect(err.message).toContain("raw");
  });
});
