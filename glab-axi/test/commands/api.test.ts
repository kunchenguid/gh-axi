import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/glab.js", () => ({
  glabJson: vi.fn(),
  glabExec: vi.fn(),
}));

import { glabExec } from "../../src/glab.js";
import { apiCommand, API_HELP } from "../../src/commands/api.js";
import type { ProjectContext } from "../../src/context.js";

const mockedGlabExec = vi.mocked(glabExec);

const ctx: ProjectContext = { fullPath: "group/project", source: "flag" };

describe("apiCommand help", () => {
  it("returns help for --help/-h or no args", async () => {
    expect(await apiCommand(["--help"])).toBe(API_HELP);
    expect(await apiCommand([])).toBe(API_HELP);
  });
});

/** Split a documented example into argv, honouring single and double quotes. */
function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | undefined;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = undefined;
      else current += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === " ") {
      if (current !== "") tokens.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current !== "") tokens.push(current);
  return tokens;
}

describe("every documented api example is accepted", () => {
  const examples = API_HELP.slice(API_HELP.indexOf("examples:"))
    .split("\n")
    .filter((line) => line.trim().startsWith("glab-axi api "))
    .map((line) => tokenize(line.trim()).slice(2));

  it("finds the examples to run", () => {
    expect(examples.length).toBeGreaterThanOrEqual(2);
  });

  for (const argv of examples) {
    it(`glab-axi api ${argv.join(" ")}`, async () => {
      vi.resetAllMocks();
      mockedGlabExec.mockResolvedValueOnce("{}");
      await expect(apiCommand(argv)).resolves.toBeTypeOf("string");
    });
  }
});

describe("apiCommand argument validation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("requires a path", async () => {
    await expect(apiCommand(["--paginate"])).rejects.toThrow(
      /API path is required/,
    );
  });

  it("rejects a method given twice", async () => {
    await expect(
      apiCommand(["-X", "POST", "POST", "projects/g%2Fp"]),
    ).rejects.toThrow(/method given twice/);
  });

  it("rejects extra positionals", async () => {
    await expect(
      apiCommand(["projects/g%2Fp", "extra"]),
    ).rejects.toThrow(/too many arguments/);
  });

  it("requires a path after a positional method", async () => {
    await expect(apiCommand(["POST"])).rejects.toThrow(/API path is required/);
  });

  it("rejects unknown flags without echoing values", async () => {
    await expect(
      apiCommand(["projects/g%2Fp", "--secret-token=abc"]),
    ).rejects.toThrow(/unknown flag --secret-token for glab-axi api/);
  });

  it("rejects an unsupported HTTP method", async () => {
    await expect(
      apiCommand(["-X", "BREW", "projects/g%2Fp"]),
    ).rejects.toThrow(/not a supported HTTP method/);
  });

  it("rejects a bare --input without a value", async () => {
    await expect(
      apiCommand(["projects/g%2Fp", "--input"]),
    ).rejects.toThrow(/--input requires a value/);
  });
});

describe("apiCommand passthrough", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("defaults to no explicit method (glab applies its own default)", async () => {
    mockedGlabExec.mockResolvedValueOnce('{"id": 1}');
    await apiCommand(["projects/g%2Fp"], ctx);
    expect(mockedGlabExec).toHaveBeenCalledWith(
      ["api", "projects/g%2Fp"],
      ctx,
    );
  });

  it("forwards a positional method as -X", async () => {
    mockedGlabExec.mockResolvedValueOnce("{}");
    await apiCommand(["POST", "projects/g%2Fp/issues"], ctx);
    expect(mockedGlabExec).toHaveBeenCalledWith(
      ["api", "projects/g%2Fp/issues", "-X", "POST"],
      ctx,
    );
  });

  it("forwards -X equivalently", async () => {
    mockedGlabExec.mockResolvedValueOnce("{}");
    await apiCommand(["-X", "DELETE", "projects/g%2Fp/issues/1"]);
    const args = mockedGlabExec.mock.calls[0]?.[0] as string[];
    expect(args).toContain("-X");
    expect(args).toContain("DELETE");
  });

  it("forwards repeatable --field, --raw-field, and --header flags", async () => {
    mockedGlabExec.mockResolvedValueOnce("{}");
    await apiCommand([
      "projects/g%2Fp/issues",
      "--field", "title=Bug",
      "--field", "labels=bug,backend",
      "--raw-field", "description=Body",
      "--header", "PRIVATE-TOKEN: x",
    ], ctx);
    expect(mockedGlabExec).toHaveBeenCalledWith(
      [
        "api", "projects/g%2Fp/issues",
        "--field", "title=Bug",
        "--field", "labels=bug,backend",
        "--raw-field", "description=Body",
        "--header", "PRIVATE-TOKEN: x",
      ],
      ctx,
    );
  });

  it("forwards --input and --paginate", async () => {
    mockedGlabExec.mockResolvedValueOnce("[]");
    await apiCommand(["projects/g%2Fp/merge_requests", "--paginate", "--input", "body.json"]);
    const args = mockedGlabExec.mock.calls[0]?.[0] as string[];
    expect(args).toContain("--paginate");
    expect(args).toEqual(expect.arrayContaining(["--input", "body.json"]));
  });

  it("encodes a JSON response as TOON", async () => {
    mockedGlabExec.mockResolvedValueOnce('{"iid": 7, "title": "T", "_links": {"self": "x"}, "author": {"username": "alice", "id": 1}}');
    const result = await apiCommand(["projects/g%2Fp/merge_requests/7"]);
    expect(result).toContain("iid: 7");
    expect(result).toContain("title: T");
    expect(result).not.toContain("_links");
    expect(result).toContain("author: alice");
    expect(result).not.toContain("id: 1");
  });

  it("strips the project's runner registration token from the output", async () => {
    mockedGlabExec.mockResolvedValueOnce(
      '{"id": 3, "runners_token": "GR1348941secret", "path_with_namespace": "g/p"}',
    );
    const result = await apiCommand(["projects/g%2Fp"], ctx);
    expect(result).not.toContain("GR1348941secret");
    expect(result).not.toContain("runners_token");
    expect(result).toContain("path_with_namespace: g/p");
  });

  it("strips the runner registration token with --full too", async () => {
    mockedGlabExec.mockResolvedValueOnce(
      '{"id": 3, "runners_token": "GR1348941secret", "path_with_namespace": "g/p"}',
    );
    const result = await apiCommand(["projects/g%2Fp", "--full"], ctx);
    expect(result).not.toContain("GR1348941secret");
    expect(result).not.toContain("runners_token");
    expect(result).toContain("path_with_namespace: g/p");
  });

  it("points a merge request response at the structured mr view", async () => {
    mockedGlabExec.mockResolvedValueOnce('{"iid": 7}');
    const result = await apiCommand(["projects/group%2Fproject/merge_requests/7"]);
    expect(result).toContain("glab-axi mr view 7 -R group/project");
  });

  it("points an issue collection at the structured issue list", async () => {
    mockedGlabExec.mockResolvedValueOnce("[]");
    const result = await apiCommand(["projects/group%2Fsub%2Fproject/issues"]);
    expect(result).toContain("glab-axi issue list -R group/sub/project");
  });

  it("keeps the caller's project when the path does not name one", async () => {
    mockedGlabExec.mockResolvedValueOnce('{"iid": 7}');
    const result = await apiCommand(["projects/:fullpath/issues/7"], ctx);
    expect(result).toContain("glab-axi issue view 7 -R group/project");
  });

  it("suggests nothing when the path names a project by numeric id", async () => {
    mockedGlabExec.mockResolvedValueOnce('{"iid": 1234}');
    const result = await apiCommand(
      ["projects/278964/merge_requests/1234"],
      { fullPath: "myteam/myapp", source: "git" },
    );
    expect(result).not.toContain("help[");
    expect(result).not.toContain("myteam/myapp");
  });

  it("suggests nothing for a path no glab-axi command wraps", async () => {
    mockedGlabExec.mockResolvedValueOnce('{"version": "17.0"}');
    const result = await apiCommand(["version"], ctx);
    expect(result).not.toContain("help[");
  });

  it("clamps very long string values unless --full", async () => {
    mockedGlabExec.mockResolvedValueOnce('{"description": "' + "x".repeat(3000) + '"}');
    const truncated = await apiCommand(["projects/g%2Fp"], ctx);
    expect(truncated).toContain("... (truncated)");

    mockedGlabExec.mockResolvedValueOnce('{"description": "' + "x".repeat(3000) + '"}');
    const full = await apiCommand(["projects/g%2Fp", "--full"]);
    expect(full).not.toContain("(truncated)");
  });

  it("wraps non-JSON output with truncation metadata", async () => {
    mockedGlabExec.mockResolvedValueOnce("x".repeat(5000));
    const result = await apiCommand(["projects/g%2Fp"], ctx);
    expect(result).toContain("api_response:");
    expect(result).toContain("truncated: true");
    expect(result).toContain("original_length: 5000");
  });

  it("does not truncate non-JSON output with --full", async () => {
    mockedGlabExec.mockResolvedValueOnce("x".repeat(5000));
    const result = await apiCommand(["projects/g%2Fp", "--full"]);
    expect(result).toContain("truncated: false");
    expect(result).not.toContain("original_length");
  });
});
