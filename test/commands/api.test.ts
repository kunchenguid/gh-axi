import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/gh.js", () => ({
  ghJson: vi.fn(),
  ghExec: vi.fn(),
  ghRaw: vi.fn(),
  ghExecWithStdin: vi.fn(),
}));

vi.mock("../../src/stdin.js", () => ({
  readStdin: vi.fn(),
  isStdinTTY: vi.fn(),
}));

import { ghExec, ghExecWithStdin } from "../../src/gh.js";
import { readStdin, isStdinTTY } from "../../src/stdin.js";
import { apiCommand, API_HELP } from "../../src/commands/api.js";

const mockedGhExec = vi.mocked(ghExec);
const mockedGhExecWithStdin = vi.mocked(ghExecWithStdin);
const mockedReadStdin = vi.mocked(readStdin);
const mockedIsStdinTTY = vi.mocked(isStdinTTY);

describe("apiCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: stdin is a TTY (no piped content) so non-stdin tests work
    // without extra setup. Override per-test when piped content is needed.
    mockedIsStdinTTY.mockReturnValue(true);
  });

  it("returns help when --help is passed", async () => {
    const result = await apiCommand(["--help"]);
    expect(result).toBe(API_HELP);
  });

  it("returns help when no args are passed", async () => {
    const result = await apiCommand([]);
    expect(result).toBe(API_HELP);
  });

  it("defaults to GET method", async () => {
    mockedGhExec.mockResolvedValue("{}");

    await apiCommand(["/repos/octo/repo"]);

    expect(mockedGhExec).toHaveBeenCalledWith(
      expect.arrayContaining(["api", "/repos/octo/repo", "--method", "GET"]),
      undefined,
    );
  });

  it("uses explicit method when provided", async () => {
    mockedGhExec.mockResolvedValue("{}");

    await apiCommand(["POST", "/repos/octo/repo/issues"]);

    expect(mockedGhExec).toHaveBeenCalledWith(
      expect.arrayContaining(["--method", "POST"]),
      undefined,
    );
  });

  it("maps -X <method> to --method instead of silently sending GET", async () => {
    mockedGhExec.mockResolvedValue("{}");

    await apiCommand([
      "-X",
      "POST",
      "/repos/octo/repo/pulls/1/requested_reviewers",
    ]);

    expect(mockedGhExec).toHaveBeenCalledWith(
      expect.arrayContaining([
        "api",
        "/repos/octo/repo/pulls/1/requested_reviewers",
        "--method",
        "POST",
      ]),
      undefined,
    );
    // The old bug forwarded no --method at all, defaulting gh itself to GET.
    const ghArgs = mockedGhExec.mock.calls[0][0];
    expect(ghArgs.filter((a) => a === "--method")).toHaveLength(1);
    expect(ghArgs).not.toContain("-X");
  });

  it("supports -X=<method> form", async () => {
    mockedGhExec.mockResolvedValue("{}");

    await apiCommand(["-X=PUT", "/repos/octo/repo/topics"]);

    expect(mockedGhExec).toHaveBeenCalledWith(
      expect.arrayContaining(["--method", "PUT"]),
      undefined,
    );
  });

  it("rejects an unsupported -X method instead of silently defaulting to GET", async () => {
    await expect(
      apiCommand(["-X", "BOGUS", "/repos/octo/repo"]),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(mockedGhExec).not.toHaveBeenCalled();
  });

  it("rejects -X given together with a positional method", async () => {
    await expect(
      apiCommand(["-X", "POST", "PUT", "/repos/octo/repo"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mockedGhExec).not.toHaveBeenCalled();
  });

  it("rejects a repeated -X instead of silently keeping the first", async () => {
    await expect(
      apiCommand(["-X", "POST", "-X", "PUT", "/repos/octo/repo"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mockedGhExec).not.toHaveBeenCalled();
  });

  it("rejects -X with no value", async () => {
    await expect(apiCommand(["/repos/octo/repo", "-X"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(mockedGhExec).not.toHaveBeenCalled();
  });

  it("passes --field flags", async () => {
    mockedGhExec.mockResolvedValue("{}");

    await apiCommand([
      "POST",
      "/repos/octo/repo/issues",
      "--field",
      "title=Bug",
    ]);

    expect(mockedGhExec).toHaveBeenCalledWith(
      expect.arrayContaining(["--field", "title=Bug"]),
      undefined,
    );
  });

  it("passes --header flags", async () => {
    mockedGhExec.mockResolvedValue("{}");

    await apiCommand([
      "/repos/octo/repo",
      "--header",
      "Accept:application/json",
    ]);

    expect(mockedGhExec).toHaveBeenCalledWith(
      expect.arrayContaining(["--header", "Accept:application/json"]),
      undefined,
    );
  });

  it("cleans JSON output by stripping noisy fields", async () => {
    mockedGhExec.mockResolvedValue(
      JSON.stringify({
        id: 1,
        title: "Test issue",
        node_id: "abc123",
        avatar_url: "https://avatars.example.com/u/123",
        user: {
          login: "alice",
          avatar_url: "https://example.com",
          node_id: "xyz",
        },
      }),
    );

    const result = await apiCommand(["/repos/octo/repo/issues/1"]);

    expect(result).toContain("Test issue");
    // node_id and avatar_url are noisy fields, should be stripped
    expect(result).not.toContain("abc123");
    expect(result).not.toContain("avatars.example.com");
    // user should be collapsed to login
    expect(result).toContain("alice");
  });

  it("wraps non-JSON output in TOON envelope", async () => {
    mockedGhExec.mockResolvedValue("plain text response");

    const result = await apiCommand(["/some/endpoint"]);

    // Should be wrapped in a TOON object, not raw text
    expect(result).toContain("api_response:");
    expect(result).toContain("plain text response");
    expect(result).toContain("truncated: false");
  });

  it("forwards --jq to gh api", async () => {
    mockedGhExec.mockResolvedValue("[]");

    await apiCommand(["/repos/octo/repo/issues/1", "--jq", "[.labels[].name]"]);

    expect(mockedGhExec).toHaveBeenCalledWith(
      expect.arrayContaining(["--jq", "[.labels[].name]"]),
      undefined,
    );
  });

  it("forwards --template to gh api", async () => {
    mockedGhExec.mockResolvedValue("out");

    await apiCommand(["/repos/octo/repo", "--template", "{{.name}}"]);

    expect(mockedGhExec).toHaveBeenCalledWith(
      expect.arrayContaining(["--template", "{{.name}}"]),
      undefined,
    );
  });

  it("does not strip fields the caller explicitly selected with --jq", async () => {
    // `url` is a noisy key by default, but selecting it by hand is deliberate.
    mockedGhExec.mockResolvedValue(
      JSON.stringify({ url: "https://api.github.com/x" }),
    );

    const result = await apiCommand([
      "/repos/octo/repo",
      "--jq",
      "{url: .url}",
    ]);

    expect(result).toContain("https://api.github.com/x");
  });

  it("rejects an unknown flag instead of silently ignoring it", async () => {
    await expect(
      apiCommand(["/repos/octo/repo", "--bogus", "x"]),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(mockedGhExec).not.toHaveBeenCalled();
  });

  it("names the offending flag without echoing its value", async () => {
    await expect(
      apiCommand(["/repos/octo/repo", "--token=hunter2"]),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("--token"),
    });
    await expect(
      apiCommand(["/repos/octo/repo", "--token=hunter2"]),
    ).rejects.not.toMatchObject({
      message: expect.stringContaining("hunter2"),
    });
  });

  it("does not consume the path when --paginate precedes it", async () => {
    mockedGhExec.mockResolvedValue("{}");

    await apiCommand(["--paginate", "/repos/octo/repo/pulls"]);

    expect(mockedGhExec).toHaveBeenCalledWith(
      expect.arrayContaining(["api", "/repos/octo/repo/pulls", "--paginate"]),
      undefined,
    );
  });

  it("rejects a repeated --jq instead of silently dropping one expression", async () => {
    await expect(
      apiCommand(["/repos/octo/repo", "--jq", ".name", "--jq", ".full_name"]),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("--jq"),
    });
    expect(mockedGhExec).not.toHaveBeenCalled();
  });

  it("rejects a repeated --template without echoing either value", async () => {
    await expect(
      apiCommand([
        "/repos/octo/repo",
        "--template={{.name}}",
        "--template={{.id}}",
      ]),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("--template"),
    });
    await expect(
      apiCommand([
        "/repos/octo/repo",
        "--template={{.name}}",
        "--template={{.id}}",
      ]),
    ).rejects.not.toMatchObject({
      message: expect.stringContaining("{{.name}}"),
    });
  });

  it("does not forward a flag-shaped --header value as its own flag", async () => {
    mockedGhExec.mockResolvedValue("{}");

    await apiCommand(["/repos/octo/repo", "--header", "--jq=.x"]);

    const ghArgs = mockedGhExec.mock.calls[0][0];
    expect(ghArgs).toEqual(expect.arrayContaining(["--header", "--jq=.x"]));
    expect(ghArgs).not.toContain("--jq");
  });

  it("truncates long string values in caller-shaped --jq output", async () => {
    const blob = "a".repeat(50_000);
    mockedGhExec.mockResolvedValue(JSON.stringify({ content: blob }));

    const result = await apiCommand([
      "/repos/octo/repo/readme",
      "--jq",
      "{content: .content}",
    ]);

    expect(result).toContain("... (truncated)");
    expect(result.length).toBeLessThan(3000);
  });

  it("repeats --field and --header flags in order", async () => {
    mockedGhExec.mockResolvedValue("{}");

    await apiCommand([
      "POST",
      "/repos/octo/repo/issues",
      "--field",
      "title=Bug",
      "--field=body=Broken",
      "--header",
      "A:1",
      "--header",
      "B:2",
    ]);

    expect(mockedGhExec).toHaveBeenCalledWith(
      expect.arrayContaining([
        "--field",
        "title=Bug",
        "--field",
        "body=Broken",
        "--header",
        "A:1",
        "--header",
        "B:2",
      ]),
      undefined,
    );
  });

  it("rejects an empty --jq value instead of silently disabling field stripping", async () => {
    await expect(
      apiCommand(["/repos/octo/repo", "--jq="]),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("--jq"),
    });
    await expect(
      apiCommand(["/repos/octo/repo", "--jq", "   "]),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(mockedGhExec).not.toHaveBeenCalled();
  });

  it("rejects an empty --template value", async () => {
    await expect(
      apiCommand(["/repos/octo/repo", "--template="]),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("--template"),
    });
    expect(mockedGhExec).not.toHaveBeenCalled();
  });

  it("does not rewrite content of a long string on the --jq path", async () => {
    const body = "see https://github.com/octo/repo/pull/5 ".repeat(10);
    mockedGhExec.mockResolvedValue(JSON.stringify({ body }));

    const result = await apiCommand([
      "/repos/octo/repo/issues/1",
      "--jq",
      "{body: .body}",
    ]);

    expect(body.length).toBeGreaterThan(200);
    expect(result).toContain("https://github.com/octo/repo/pull/5");
    expect(result).not.toContain("PR#5");
  });

  it("still cleans long strings on the default path", async () => {
    const body = "see https://github.com/octo/repo/pull/5 ".repeat(10);
    mockedGhExec.mockResolvedValue(JSON.stringify({ body }));

    const result = await apiCommand(["/repos/octo/repo/issues/1"]);

    expect(result).toContain("PR#5");
  });

  it("rejects an extra positional instead of silently ignoring it", async () => {
    await expect(
      apiCommand(["/repos/octo/repo", "/extra"]),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(
      apiCommand(["POST", "/repos/octo/repo", "/extra"]),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(mockedGhExec).not.toHaveBeenCalled();
  });

  it("rejects a lone HTTP method with no path", async () => {
    await expect(apiCommand(["POST"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("path is required"),
    });
    expect(mockedGhExec).not.toHaveBeenCalled();
  });

  it("rejects a value flag with no value", async () => {
    await expect(
      apiCommand(["/repos/octo/repo", "--jq"]),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("wraps truncated non-JSON output in TOON envelope with truncation metadata", async () => {
    const longText = "x".repeat(5000);
    mockedGhExec.mockResolvedValue(longText);

    const result = await apiCommand(["/some/endpoint"]);

    expect(result).toContain("api_response:");
    expect(result).toContain("truncated: true");
    expect(result).toContain("original_length: 5000");
    // The body itself should be truncated
    expect(result.length).toBeLessThan(5000);
  });

  it("preserves complete string values and noisy fields with --full", async () => {
    const blob = "a".repeat(5000);
    mockedGhExec.mockResolvedValue(
      JSON.stringify({
        content: blob,
        node_id: "abc123",
        avatar_url: "https://avatars.example.com/u/123",
      }),
    );

    const result = await apiCommand([
      "/repos/octo/repo/contents/README.md",
      "--full",
    ]);

    expect(result).toContain(blob);
    expect(result).not.toContain("... (truncated)");
    // --full preserves every field, including ones the compact default strips.
    expect(result).toContain("abc123");
    expect(result).toContain("avatars.example.com");
  });

  it("does not forward --full to gh", async () => {
    mockedGhExec.mockResolvedValue("{}");

    await apiCommand(["/repos/octo/repo", "--full"]);

    const ghArgs = mockedGhExec.mock.calls[0][0];
    expect(ghArgs).not.toContain("--full");
  });

  it("preserves the complete non-JSON body with --full", async () => {
    const longText = "x".repeat(5000);
    mockedGhExec.mockResolvedValue(longText);

    const result = await apiCommand(["/some/endpoint", "--full"]);

    expect(result).toContain("api_response:");
    expect(result).toContain("truncated: false");
    expect(result).not.toContain("original_length:");
    expect(result.length).toBeGreaterThan(5000);
  });

  it("rejects --full with a value", async () => {
    await expect(
      apiCommand(["/repos/octo/repo", "--full=true"]),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  describe("--input", () => {
    it("passes --input <file> straight through to gh via ghExec", async () => {
      mockedGhExec.mockResolvedValue("{}");

      await apiCommand([
        "PUT",
        "/repos/octo/repo/branches/main/protection",
        "--input",
        "body.json",
      ]);

      expect(mockedGhExec).toHaveBeenCalledWith(
        expect.arrayContaining(["--input", "body.json"]),
        undefined,
      );
      expect(mockedGhExecWithStdin).not.toHaveBeenCalled();
    });

    it("round-trips a nested JSON body byte-exact through --input -", async () => {
      const nestedBody = JSON.stringify({
        required_status_checks: {
          strict: true,
          contexts: ["ci/build", "ci/test"],
        },
        enforce_admins: true,
        required_pull_request_reviews: null,
        restrictions: null,
      });
      mockedIsStdinTTY.mockReturnValue(false);
      mockedReadStdin.mockResolvedValue(nestedBody);
      mockedGhExecWithStdin.mockResolvedValue("{}");

      await apiCommand([
        "PUT",
        "/repos/octo/repo/branches/main/protection",
        "--input",
        "-",
      ]);

      const [capturedArgs, capturedStdin] = mockedGhExecWithStdin.mock.calls[0];
      expect(capturedArgs).toEqual([
        "api",
        "/repos/octo/repo/branches/main/protection",
        "--method",
        "PUT",
        "--input",
        "-",
      ]);
      // Byte-exact: what was read from our stdin is exactly what is relayed
      // to gh's stdin, with no re-encoding or mutation in between.
      expect(capturedStdin).toBe(nestedBody);
      expect(mockedGhExec).not.toHaveBeenCalled();
    });

    it("rejects --input - when stdin is an interactive TTY", async () => {
      mockedIsStdinTTY.mockReturnValue(true);

      await expect(
        apiCommand([
          "PUT",
          "/repos/octo/repo/branches/main/protection",
          "--input",
          "-",
        ]),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(mockedReadStdin).not.toHaveBeenCalled();
    });

    it("rejects --input given more than once", async () => {
      await expect(
        apiCommand([
          "/repos/octo/repo",
          "--input",
          "a.json",
          "--input",
          "b.json",
        ]),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("rejects --input without a value", async () => {
      await expect(
        apiCommand(["/repos/octo/repo", "--input"]),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("rejects --input when the next argument is another supported flag", async () => {
      await expect(
        apiCommand(["/repos/octo/repo", "--input", "--paginate"]),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(mockedGhExec).not.toHaveBeenCalled();
    });
  });
});
