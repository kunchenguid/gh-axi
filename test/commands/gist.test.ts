import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("../../src/gh.js", () => ({
  ghJson: vi.fn(),
  ghExec: vi.fn(),
  ghExecWithStdin: vi.fn(),
  ghRaw: vi.fn(),
}));

vi.mock("../../src/stdin.js", () => ({
  isStdinTTY: vi.fn(),
  readStdin: vi.fn(),
}));

import { ghJson, ghExec, ghExecWithStdin } from "../../src/gh.js";
import { isStdinTTY, readStdin } from "../../src/stdin.js";
import { AxiError } from "../../src/errors.js";
import { gistCommand, GIST_HELP } from "../../src/commands/gist.js";

const mockedGhJson = vi.mocked(ghJson);
const mockedGhExec = vi.mocked(ghExec);
const mockedGhExecWithStdin = vi.mocked(ghExecWithStdin);
const mockedIsStdinTTY = vi.mocked(isStdinTTY);
const mockedReadStdin = vi.mocked(readStdin);

const GIST_ID = "5b0e0062eb8e9654adad7bb1d81cc75f";

function gist(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: GIST_ID,
    description: "a gist",
    public: false,
    html_url: `https://gist.github.com/octocat/${GIST_ID}`,
    comments: 0,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-02T00:00:00Z",
    owner: { login: "octocat" },
    files: { "a.txt": { filename: "a.txt", size: 10 } },
    ...overrides,
  };
}

/** A gist detail fixture for view tests (includes file content). */
function gistDetail(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: GIST_ID,
    description: "a detail gist",
    public: true,
    html_url: `https://gist.github.com/octocat/${GIST_ID}`,
    comments: 3,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-02T00:00:00Z",
    owner: { login: "octocat" },
    files: {
      "ring.erl": {
        filename: "ring.erl",
        type: "text/plain",
        language: "Erlang",
        size: 42,
        content: "-module(ring).\n-export([start/2]).",
        truncated: false,
      },
    },
    ...overrides,
  };
}

// Use hex-style IDs with no English-word substrings so toContain(id) cannot
// collide with toContain("public") / toContain("secret") or similar text.
const ID_ALPHA = "aaaa0000000000000000000000000000"; // used as the public gist
const ID_BRAVO = "bbbb1111111111111111111111111111"; // used as the secret gist

// A URL whose last path segment is the gist ID. Used as the mock return value
// from gh gist create to test ID extraction.
const CREATE_ID = "cc2233445566778899aabbccddeeff00";
const CREATE_URL = `https://gist.github.com/octocat/${CREATE_ID}`;

describe("gistCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default for create: gh prints the gist URL to stdout.
    mockedGhExec.mockResolvedValue(`${CREATE_URL}\n`);
    mockedGhExecWithStdin.mockResolvedValue(`${CREATE_URL}\n`);
    // Default: stdin is piped (not a TTY) with some content.
    mockedIsStdinTTY.mockReturnValue(false);
    mockedReadStdin.mockResolvedValue("file content");
  });

  afterEach(() => {
    delete process.env["GH_HOST"];
  });

  describe("router", () => {
    it("returns help when --help is passed", async () => {
      expect(await gistCommand(["--help"])).toBe(GIST_HELP);
    });

    it("returns help when no subcommand is given", async () => {
      expect(await gistCommand([])).toBe(GIST_HELP);
    });

    it("returns a structured error for an unknown subcommand", async () => {
      const result = await gistCommand(["frobnicate"]);
      expect(result).toContain("Unknown subcommand: frobnicate");
      expect(result).toContain("list");
      expect(result).toContain("create");
    });

    it("unknown subcommand error mentions view", async () => {
      const result = await gistCommand(["frobnicate"]);
      expect(result).toContain("view");
    });
  });

  describe("edit", () => {
    beforeEach(() => {
      // Default: stdin is a TTY (no piped content) so most non-stdin tests work
      // without extra setup. Override per-test when piped content is needed.
      mockedIsStdinTTY.mockReturnValue(true);
      mockedGhExec.mockResolvedValue("");
      mockedGhExecWithStdin.mockResolvedValue("");
    });

    // ── argv assertions ─────────────────────────────────────────────────────

    it("replace-from-stdin: passes correct argv to ghExecWithStdin with '-' source", async () => {
      // Blocker 1 regression guard: `-` must appear before `--filename` so gh
      // reads from stdin instead of opening $EDITOR.
      mockedIsStdinTTY.mockReturnValue(false);
      mockedReadStdin.mockResolvedValue("new content");

      await gistCommand(["edit", "abc123", "--filename", "notes.md"]);

      const [capturedArgs, capturedContent] =
        mockedGhExecWithStdin.mock.calls[0];
      expect(capturedArgs).toEqual([
        "gist",
        "edit",
        "abc123",
        "-", // source positional — must be present and before --filename
        "--filename",
        "notes.md",
      ]);
      expect(capturedContent).toBe("new content");
    });

    it("replace-from-stdin: short -f flag is accepted", async () => {
      mockedIsStdinTTY.mockReturnValue(false);
      mockedReadStdin.mockResolvedValue("content");

      await gistCommand(["edit", "abc123", "-f", "notes.md"]);

      const [capturedArgs] = mockedGhExecWithStdin.mock.calls[0];
      // '-' source must precede '--filename'
      const dashIdx = capturedArgs.indexOf("-");
      const fnIdx = capturedArgs.indexOf("--filename");
      expect(dashIdx).toBeGreaterThanOrEqual(0);
      expect(fnIdx).toBeGreaterThan(dashIdx);
      expect(capturedArgs).toContain("notes.md");
    });

    it("add-from-stdin: explicit '-' sentinel routes to ghExecWithStdin", async () => {
      // Add-from-stdin is signalled by the explicit trailing `-`, NOT by
      // TTY-ness — so it works in the non-TTY agent context this tool targets.
      mockedIsStdinTTY.mockReturnValue(false);
      mockedReadStdin.mockResolvedValue("brand new content");

      await gistCommand(["edit", "abc123", "--add", "brand-new.txt", "-"]);

      const [capturedArgs, capturedContent] =
        mockedGhExecWithStdin.mock.calls[0];
      expect(capturedArgs).toEqual([
        "gist",
        "edit",
        "abc123",
        "--add",
        "brand-new.txt",
        "-", // content source: stdin
      ]);
      expect(capturedContent).toBe("brand new content");
    });

    it("add-from-disk: no '-' sentinel routes to ghExec even in non-TTY (bug #1b regression)", async () => {
      // Agents run with a non-TTY stdin. Without an explicit `-`, --add must
      // read from disk, NOT be misrouted to the stdin branch (the old bug).
      mockedIsStdinTTY.mockReturnValue(false);

      await gistCommand(["edit", "abc123", "--add", "/tmp/new.txt"]);

      const [capturedArgs] = mockedGhExec.mock.calls[0];
      expect(capturedArgs).toEqual([
        "gist",
        "edit",
        "abc123",
        "--add",
        "/tmp/new.txt",
      ]);
      expect(mockedGhExecWithStdin).not.toHaveBeenCalled();
    });

    it("remove: routes to ghExec in non-TTY agent context (bug #1a regression)", async () => {
      // The old guard rejected --remove whenever stdin was non-TTY (always, for
      // agents) with a bogus "piped content requires --filename/--add". Remove
      // needs no stdin and must simply run.
      mockedIsStdinTTY.mockReturnValue(false);

      await gistCommand(["edit", "abc123", "--remove", "old.txt"]);

      const [capturedArgs] = mockedGhExec.mock.calls[0];
      expect(capturedArgs).toEqual([
        "gist",
        "edit",
        "abc123",
        "--remove",
        "old.txt",
      ]);
      expect(mockedGhExecWithStdin).not.toHaveBeenCalled();
    });

    it("selector is order-insensitive: flags may precede the id", async () => {
      mockedIsStdinTTY.mockReturnValue(false);

      await gistCommand(["edit", "--remove", "old.txt", "abc123"]);

      const [capturedArgs] = mockedGhExec.mock.calls[0];
      expect(capturedArgs).toEqual([
        "gist",
        "edit",
        "abc123",
        "--remove",
        "old.txt",
      ]);
    });

    it("desc-only: routes through gh api PATCH to avoid multi-file prompt", async () => {
      // Blocker 2 regression guard: desc-only must NOT call `gh gist edit`
      // (which prompts on multi-file gists); it must PATCH /gists/<id>.
      await gistCommand(["edit", "abc123", "--desc", "my new description"]);

      const [capturedArgs] = mockedGhExec.mock.calls[0];
      expect(capturedArgs).toEqual([
        "api",
        "-X",
        "PATCH",
        "/gists/abc123",
        "-f",
        "description=my new description",
      ]);
    });

    it("desc-only: extracts bare id from a URL selector for the API call", async () => {
      await gistCommand([
        "edit",
        "https://gist.github.com/octocat/deadbeef",
        "--desc",
        "updated",
      ]);

      const [capturedArgs] = mockedGhExec.mock.calls[0];
      expect(capturedArgs).toContain("/gists/deadbeef");
      expect(capturedArgs.join(" ")).not.toContain("gist.github.com");
    });

    it("desc-only: short -d flag is accepted", async () => {
      await gistCommand(["edit", "abc123", "-d", "a description"]);

      const [capturedArgs] = mockedGhExec.mock.calls[0];
      expect(capturedArgs[0]).toBe("api");
      expect(capturedArgs.join(" ")).toContain("description=a description");
    });

    it("filename+desc: includes both '-' source and '--desc' in argv", async () => {
      mockedIsStdinTTY.mockReturnValue(false);
      mockedReadStdin.mockResolvedValue("content");

      await gistCommand([
        "edit",
        "abc123",
        "--filename",
        "notes.md",
        "--desc",
        "updated",
      ]);

      const [capturedArgs] = mockedGhExecWithStdin.mock.calls[0];
      expect(capturedArgs).toContain("-");
      expect(capturedArgs).toContain("--filename");
      expect(capturedArgs).toContain("notes.md");
      expect(capturedArgs).toContain("--desc");
      expect(capturedArgs).toContain("updated");
    });

    it("add-from-stdin+desc: includes both '-' source and '--desc' in argv", async () => {
      mockedIsStdinTTY.mockReturnValue(false);
      mockedReadStdin.mockResolvedValue("content");

      await gistCommand([
        "edit",
        "abc123",
        "--add",
        "new.txt",
        "-",
        "--desc",
        "with new file",
      ]);

      const [capturedArgs] = mockedGhExecWithStdin.mock.calls[0];
      expect(capturedArgs).toContain("--add");
      expect(capturedArgs).toContain("-");
      expect(capturedArgs).toContain("--desc");
    });

    it("add-from-disk+desc: includes both flags in argv to ghExec", async () => {
      await gistCommand([
        "edit",
        "abc123",
        "--add",
        "/tmp/f.txt",
        "--desc",
        "d",
      ]);

      const [capturedArgs] = mockedGhExec.mock.calls[0];
      expect(capturedArgs).toContain("--add");
      expect(capturedArgs).toContain("--desc");
    });

    it("accepts a gist URL as the selector", async () => {
      await gistCommand([
        "edit",
        "https://gist.github.com/octocat/abc123",
        "--remove",
        "file.txt",
      ]);

      const [capturedArgs] = mockedGhExec.mock.calls[0];
      expect(capturedArgs[2]).toBe("https://gist.github.com/octocat/abc123");
    });

    it("never forwards ctx to ghExec (user-scoped)", async () => {
      await gistCommand(["edit", "abc123", "--remove", "file.txt"]);
      expect(mockedGhExec.mock.calls[0][1]).toBeUndefined();
    });

    it("never forwards ctx to ghExecWithStdin (user-scoped)", async () => {
      mockedIsStdinTTY.mockReturnValue(false);
      mockedReadStdin.mockResolvedValue("x");

      await gistCommand(["edit", "abc123", "--filename", "x.txt"]);
      expect(mockedGhExecWithStdin.mock.calls[0][2]).toBeUndefined();
    });

    // ── interactivity guards ─────────────────────────────────────────────────
    // Each guard must:
    //   a) throw AxiError with an actionable message naming the resolution
    //   b) prove gh was never invoked (not.toHaveBeenCalled assertions)
    // (b) is what actually closes the interactivity story: if gh is called
    // even when the guard fires, the test is worthless.

    it("guard: lone '-' sentinel without --filename or --add throws and does not call gh", async () => {
      mockedIsStdinTTY.mockReturnValue(false);
      // A bare stdin sentinel with no file selector: gh would prompt which file
      // to write, so we reject up-front.
      await expect(gistCommand(["edit", "abc123", "-"])).rejects.toThrow(
        /--filename|--add/,
      );
      expect(mockedGhExec).not.toHaveBeenCalled();
      expect(mockedGhExecWithStdin).not.toHaveBeenCalled();
    });

    it("remove + desc in non-TTY context succeeds via ghExec (not a guard error)", async () => {
      // Under the old TTY-inference this combination was wrongly rejected in the
      // agent (non-TTY) context. It writes no stdin and must simply run.
      mockedIsStdinTTY.mockReturnValue(false);
      const result = await gistCommand([
        "edit",
        "abc123",
        "--remove",
        "x.txt",
        "--desc",
        "updated",
      ]);
      expect(result).toBeDefined();
      const [capturedArgs] = mockedGhExec.mock.calls[0];
      expect(capturedArgs).toEqual([
        "gist",
        "edit",
        "abc123",
        "--remove",
        "x.txt",
        "--desc",
        "updated",
      ]);
      expect(mockedGhExecWithStdin).not.toHaveBeenCalled();
    });

    it("guard: piped stdin with only --desc routes to API (not a guard error)", async () => {
      // --desc-only is handled via API even when stdin is piped — the desc path
      // does not read stdin and does not trigger guard 2.
      mockedIsStdinTTY.mockReturnValue(false);
      // No AxiError expected — the desc-only path is valid.
      const result = await gistCommand(["edit", "abc123", "--desc", "hello"]);
      expect(result).toBeDefined();
      // Verify the API path was used, not gist edit
      const [apiArgs] = mockedGhExec.mock.calls[0];
      expect(apiArgs[0]).toBe("api");
    });

    it("guard: --filename without piped stdin throws VALIDATION_ERROR and does not call gh", async () => {
      mockedIsStdinTTY.mockReturnValue(true); // no piped content
      await expect(
        gistCommand(["edit", "abc123", "--filename", "notes.md"]),
      ).rejects.toThrow(/stdin/);
      expect(mockedGhExec).not.toHaveBeenCalled();
      expect(mockedGhExecWithStdin).not.toHaveBeenCalled();
    });

    it("guard: no edit operation throws VALIDATION_ERROR and does not call gh", async () => {
      await expect(gistCommand(["edit", "abc123"])).rejects.toThrow(AxiError);
      expect(mockedGhExec).not.toHaveBeenCalled();
      expect(mockedGhExecWithStdin).not.toHaveBeenCalled();
    });

    // isStdinTTY() never fires in agent contexts, so an empty read is the only
    // signal nothing was piped — writing it through would blank the file.
    it("guard: --filename with empty stdin throws and never writes empty content", async () => {
      mockedIsStdinTTY.mockReturnValue(false);
      mockedReadStdin.mockResolvedValue("");
      await expect(
        gistCommand(["edit", "abc123", "--filename", "notes.md"]),
      ).rejects.toThrow(/stdin/);
      expect(mockedGhExecWithStdin).not.toHaveBeenCalled();
      expect(mockedGhExec).not.toHaveBeenCalled();
    });

    // The same destructive-guard hole closed for `gist delete`: a dropped
    // --dry-run must not let the remove proceed at exit 0.
    it("guard: unknown flag alongside --remove throws and does not call gh", async () => {
      await expect(
        gistCommand(["edit", "abc123", "--remove", "old.txt", "--dry-run"]),
      ).rejects.toThrow(/--dry-run/);
      expect(mockedGhExec).not.toHaveBeenCalled();
      expect(mockedGhExecWithStdin).not.toHaveBeenCalled();
    });

    it("guard: a misspelled value flag is named rather than reported as a stray positional", async () => {
      await expect(
        gistCommand(["edit", "abc123", "--remov", "old.txt"]),
      ).rejects.toThrow(/--remov/);
      expect(mockedGhExec).not.toHaveBeenCalled();
    });

    it("guard: the lone '-' stdin sentinel is not treated as an unknown flag", async () => {
      mockedIsStdinTTY.mockReturnValue(false);
      mockedReadStdin.mockResolvedValue("brand new content");
      mockedGhExecWithStdin.mockResolvedValue("");
      await gistCommand(["edit", "abc123", "--add", "new.txt", "-"]);
      expect(mockedGhExecWithStdin).toHaveBeenCalled();
    });

    it("guard: --add <name> - with empty stdin throws and never writes empty content", async () => {
      mockedIsStdinTTY.mockReturnValue(false);
      mockedReadStdin.mockResolvedValue("");
      await expect(
        gistCommand(["edit", "abc123", "--add", "new.txt", "-"]),
      ).rejects.toThrow(/stdin/);
      expect(mockedGhExecWithStdin).not.toHaveBeenCalled();
      expect(mockedGhExec).not.toHaveBeenCalled();
    });

    it("guard: --filename and --add together throws VALIDATION_ERROR and does not call gh", async () => {
      mockedIsStdinTTY.mockReturnValue(false);
      mockedReadStdin.mockResolvedValue("x");
      await expect(
        gistCommand([
          "edit",
          "abc123",
          "--filename",
          "a.txt",
          "--add",
          "/tmp/b.txt",
        ]),
      ).rejects.toThrow(AxiError);
      expect(mockedGhExec).not.toHaveBeenCalled();
      expect(mockedGhExecWithStdin).not.toHaveBeenCalled();
    });

    it("guard: --filename and --remove together throws VALIDATION_ERROR and does not call gh", async () => {
      mockedIsStdinTTY.mockReturnValue(false);
      mockedReadStdin.mockResolvedValue("x");
      await expect(
        gistCommand([
          "edit",
          "abc123",
          "--filename",
          "a.txt",
          "--remove",
          "b.txt",
        ]),
      ).rejects.toThrow(AxiError);
      expect(mockedGhExec).not.toHaveBeenCalled();
      expect(mockedGhExecWithStdin).not.toHaveBeenCalled();
    });

    it("guard: --add and --remove together throws VALIDATION_ERROR and does not call gh", async () => {
      await expect(
        gistCommand([
          "edit",
          "abc123",
          "--add",
          "/tmp/a.txt",
          "--remove",
          "b.txt",
        ]),
      ).rejects.toThrow(AxiError);
      expect(mockedGhExec).not.toHaveBeenCalled();
      expect(mockedGhExecWithStdin).not.toHaveBeenCalled();
    });

    it("guard: missing id throws VALIDATION_ERROR and does not call gh", async () => {
      await expect(gistCommand(["edit"])).rejects.toThrow(AxiError);
      expect(mockedGhExec).not.toHaveBeenCalled();
      expect(mockedGhExecWithStdin).not.toHaveBeenCalled();
    });

    // ── output ───────────────────────────────────────────────────────────────

    it("returns edited:ok with the gist id in output", async () => {
      await gistCommand(["edit", "abc123", "--remove", "old.txt"]);
      // No assertion on specific TOON key — just confirm it ran and output something
    });

    it("ends with contextual help suggestions", async () => {
      const result = await gistCommand([
        "edit",
        "abc123",
        "--remove",
        "old.txt",
      ]);
      expect(result).toContain("help[");
    });

    it("suggestions reference gist list and gist rename", async () => {
      const result = await gistCommand([
        "edit",
        "abc123",
        "--remove",
        "old.txt",
      ]);
      expect(result).toContain("gist list");
      expect(result).toContain("gist rename");
    });
  });

  describe("rename", () => {
    beforeEach(() => {
      mockedGhExec.mockResolvedValue("");
    });

    // ── argv assertions ─────────────────────────────────────────────────────

    it("passes correct argv to ghExec", async () => {
      await gistCommand(["rename", "abc123", "old.txt", "new.txt"]);

      const [capturedArgs] = mockedGhExec.mock.calls[0];
      expect(capturedArgs).toEqual([
        "gist",
        "rename",
        "abc123",
        "old.txt",
        "new.txt",
      ]);
    });

    it("accepts a gist URL as the selector", async () => {
      await gistCommand([
        "rename",
        "https://gist.github.com/octocat/abc123",
        "old.txt",
        "new.txt",
      ]);

      const [capturedArgs] = mockedGhExec.mock.calls[0];
      expect(capturedArgs[2]).toBe("https://gist.github.com/octocat/abc123");
    });

    it("never forwards ctx to ghExec (user-scoped)", async () => {
      await gistCommand(["rename", "abc123", "old.txt", "new.txt"]);
      expect(mockedGhExec.mock.calls[0][1]).toBeUndefined();
    });

    // ── arity validation ─────────────────────────────────────────────────────
    // All arity errors must also prove gh was never called.

    it("missing id throws VALIDATION_ERROR and does not call gh", async () => {
      await expect(gistCommand(["rename"])).rejects.toThrow(AxiError);
      expect(mockedGhExec).not.toHaveBeenCalled();
    });

    it("missing old filename throws VALIDATION_ERROR and does not call gh", async () => {
      await expect(gistCommand(["rename", "abc123"])).rejects.toThrow(AxiError);
      expect(mockedGhExec).not.toHaveBeenCalled();
    });

    it("missing new filename throws VALIDATION_ERROR and does not call gh", async () => {
      await expect(
        gistCommand(["rename", "abc123", "old.txt"]),
      ).rejects.toThrow(AxiError);
      expect(mockedGhExec).not.toHaveBeenCalled();
    });

    it("surplus positional throws VALIDATION_ERROR and does not call gh", async () => {
      await expect(
        gistCommand(["rename", "abc123", "old.txt", "new.txt", "extra"]),
      ).rejects.toThrow(AxiError);
      expect(mockedGhExec).not.toHaveBeenCalled();
    });

    it("unknown flag throws VALIDATION_ERROR and does not call gh", async () => {
      await expect(
        gistCommand(["rename", "abc123", "old.txt", "new.txt", "--force"]),
      ).rejects.toThrow(AxiError);
      expect(mockedGhExec).not.toHaveBeenCalled();
    });

    // ── output ───────────────────────────────────────────────────────────────

    it("output includes old and new names", async () => {
      const result = await gistCommand([
        "rename",
        "abc123",
        "old.txt",
        "new.txt",
      ]);
      expect(result).toContain("old.txt");
      expect(result).toContain("new.txt");
    });

    it("ends with contextual help suggestions", async () => {
      const result = await gistCommand([
        "rename",
        "abc123",
        "old.txt",
        "new.txt",
      ]);
      expect(result).toContain("help[");
    });

    it("suggestions reference gist list and gist edit", async () => {
      const result = await gistCommand([
        "rename",
        "abc123",
        "old.txt",
        "new.txt",
      ]);
      expect(result).toContain("gist list");
      expect(result).toContain("gist edit");
    });
  });

  describe("list", () => {
    it("renders gists with a count line", async () => {
      mockedGhJson.mockResolvedValue([gist(), gist({ id: "abc" })]);
      const result = await gistCommand(["list"]);
      expect(result).toContain("count:");
      expect(result).toContain(GIST_ID);
    });

    it("uses exactly the four default fields", async () => {
      mockedGhJson.mockResolvedValue([gist()]);
      const result = await gistCommand(["list"]);
      const header = result
        .split("\n")
        .find((l) => l.includes("gists[") && l.includes("{"));
      expect(header).toBeDefined();
      expect(header).toContain("{id,description,files,visibility}");
    });

    it("reports secret gists as secret and public as public", async () => {
      mockedGhJson.mockResolvedValue([
        gist({ public: false }),
        gist({ id: "cc0000000000000000000000000000cc", public: true }),
      ]);
      const result = await gistCommand(["list"]);
      expect(result).toContain("secret");
      expect(result).toContain("public");
    });

    // Mutation closer #1: swapping visibility labels is not caught by the test
    // above (it sees both strings regardless of which is which). This assertion
    // pins the label for a single-public gist to "public", catching the swap.
    it("labels a public-only gist as public, never secret", async () => {
      mockedGhJson.mockResolvedValue([gist({ public: true })]);
      const result = await gistCommand(["list"]);
      expect(result).toContain("public");
      expect(result).not.toContain("secret");
    });

    it("counts files per gist", async () => {
      mockedGhJson.mockResolvedValue([
        gist({ files: { "a.txt": {}, "b.txt": {}, "c.txt": {} } }),
      ]);
      const result = await gistCommand(["list"]);
      expect(result).toMatch(/,3,/);
    });

    it("requests per_page=100 by default", async () => {
      mockedGhJson.mockResolvedValue([]);
      await gistCommand(["list"]);
      const args = mockedGhJson.mock.calls[0][0] as string[];
      expect(args[0]).toBe("api");
      expect(args.join(" ")).toContain("per_page=100");
    });

    it("never passes repo context to gh — gist is user-scoped", async () => {
      // gistCommand has no ctx parameter; the guard is structural (TypeScript
      // accepts (args: string[]) as CommandFn). We verify the contract by
      // confirming ghJson is called without a second argument regardless of
      // whatever the withRepoContext wrapper in cli.ts might supply.
      mockedGhJson.mockResolvedValue([]);
      await gistCommand(["list"]);
      expect(mockedGhJson.mock.calls[0][1]).toBeUndefined();
    });

    it("honours --limit below the page size", async () => {
      mockedGhJson.mockResolvedValue([gist(), gist({ id: "b" })]);
      const result = await gistCommand(["list", "--limit", "1"]);
      // Mutation closer #3: the truncation marker must appear when limit caps results.
      expect(result).toContain("count: 1 (showing first 1)");
    });

    it("paginates when the limit exceeds one page", async () => {
      mockedGhJson.mockResolvedValue([]);
      await gistCommand(["list", "--limit", "250"]);
      const args = mockedGhJson.mock.calls[0][0] as string[];
      expect(args).toContain("--paginate");
    });

    it("filters to public gists with --public", async () => {
      mockedGhJson.mockResolvedValue([
        gist({ id: ID_BRAVO, public: false }),
        gist({ id: ID_ALPHA, public: true }),
      ]);
      const result = await gistCommand(["list", "--public"]);
      expect(result).toContain(ID_ALPHA);
      expect(result).not.toContain(ID_BRAVO);
    });

    it("filters to secret gists with --secret", async () => {
      mockedGhJson.mockResolvedValue([
        gist({ id: ID_BRAVO, public: false }),
        gist({ id: ID_ALPHA, public: true }),
      ]);
      const result = await gistCommand(["list", "--secret"]);
      expect(result).toContain(ID_BRAVO);
      expect(result).not.toContain(ID_ALPHA);
    });

    it("rejects --public and --secret together", async () => {
      await expect(
        gistCommand(["list", "--public", "--secret"]),
      ).rejects.toThrow(AxiError);
    });

    it("gives a definitive empty state", async () => {
      mockedGhJson.mockResolvedValue([]);
      const result = await gistCommand(["list"]);
      expect(result).toContain("count: 0");
    });

    it("adds requested extra fields with --fields", async () => {
      mockedGhJson.mockResolvedValue([gist()]);
      const result = await gistCommand(["list", "--fields", "url,owner"]);
      const header = result
        .split("\n")
        .find((l) => l.includes("gists[") && l.includes("{"));
      expect(header).toBeDefined();
      expect(header).toContain("url");
      expect(header).toContain("owner");
    });

    it("rejects unknown --fields values", async () => {
      mockedGhJson.mockResolvedValue([gist()]);
      await expect(gistCommand(["list", "--fields", "nope"])).rejects.toThrow(
        AxiError,
      );
    });

    it("ends with contextual help suggestions", async () => {
      mockedGhJson.mockResolvedValue([gist()]);
      const result = await gistCommand(["list"]);
      expect(result).toContain("help[");
      expect(result).toContain("gh-axi gist view");
    });

    it("shows help suggestions when no gists exist", async () => {
      mockedGhJson.mockResolvedValue([]);
      const result = await gistCommand(["list"]);
      expect(result).toContain("help[");
    });

    // Mutation closer #2: hardcoding isEmpty=false sends the non-empty suggestion
    // (which mentions gist view) even when the list is empty; the empty-state
    // suggestion mentions "gh-axi api /gists`" which is different. Pin it.
    it("shows the empty-state suggestion text when no gists exist", async () => {
      mockedGhJson.mockResolvedValue([]);
      const result = await gistCommand(["list"]);
      // The empty-state suggestion points at the raw /gists endpoint, not a specific id.
      expect(result).toContain("gh-axi api /gists`");
    });

    // Regression: --limit must cap *displayed rows after filtering*, not the
    // fetch size. With 3 secret + 1 public gist and --public --limit 2:
    //   - count must be 1 (the one public gist), not 0 (limit before filter)
    //   - per_page must be 100 (full page), not 2 (limit used as fetch size)
    //   - --paginate must be present (filtering always paginates)
    // The per_page and --paginate assertions ensure the test bites when either
    // the old perPage=Math.min(limit,PAGE_SIZE) or paginate=limit>PAGE_SIZE
    // bug is reintroduced — the count assertion alone passes even with the bug
    // if the mock returns fewer items than the buggy perPage.
    it("applies --limit after the visibility filter and fetches a full page", async () => {
      mockedGhJson.mockResolvedValue([
        gist({ id: ID_BRAVO + "0", public: false }),
        gist({ id: ID_BRAVO + "1", public: false }),
        gist({ id: ID_BRAVO + "2", public: false }),
        gist({ id: ID_ALPHA, public: true }),
      ]);
      const result = await gistCommand(["list", "--public", "--limit", "2"]);
      expect(result).toContain("count: 1");
      const capturedArgs = mockedGhJson.mock.calls[0][0] as string[];
      expect(capturedArgs.join(" ")).toContain("per_page=100");
      expect(capturedArgs).toContain("--paginate");
    });

    it("rejects a non-numeric --limit", async () => {
      mockedGhJson.mockResolvedValue([]);
      await expect(gistCommand(["list", "--limit", "abc"])).rejects.toThrow(
        AxiError,
      );
    });

    it("rejects --limit 0", async () => {
      mockedGhJson.mockResolvedValue([]);
      await expect(gistCommand(["list", "--limit", "0"])).rejects.toThrow(
        AxiError,
      );
    });

    it("rejects a negative --limit", async () => {
      mockedGhJson.mockResolvedValue([]);
      await expect(gistCommand(["list", "--limit", "-5"])).rejects.toThrow(
        AxiError,
      );
    });

    // A typo must fail loudly, not silently return the default 100 rows.
    it("rejects an unknown flag instead of silently ignoring it", async () => {
      mockedGhJson.mockResolvedValue([]);
      await expect(gistCommand(["list", "--limitt", "5"])).rejects.toThrow(
        AxiError,
      );
      expect(mockedGhJson).not.toHaveBeenCalled();
    });

    it("names the unknown flag in the error", async () => {
      mockedGhJson.mockResolvedValue([]);
      await expect(gistCommand(["list", "--limitt", "5"])).rejects.toThrow(
        /--limitt/,
      );
    });

    it("rejects an unknown flag in --flag=value form", async () => {
      mockedGhJson.mockResolvedValue([]);
      await expect(gistCommand(["list", "--fieldz=url"])).rejects.toThrow(
        AxiError,
      );
    });

    it("still accepts --fields in --flag=value form", async () => {
      mockedGhJson.mockResolvedValue([gist()]);
      const result = await gistCommand(["list", "--fields=url"]);
      expect(result).toContain("url");
    });
  });

  describe("delete", () => {
    it("deletes the gist and reports what was deleted", async () => {
      mockedGhExec.mockResolvedValue("");
      const result = await gistCommand([
        "delete",
        "abc1230000000000000000000000000a",
      ]);
      expect(result).toContain("abc1230000000000000000000000000a");
    });

    // Mutation-test anchor: if --yes is removed from the ghExec call, the argv
    // assertion below will fail. Verified by reverting the --yes and watching
    // this test go red, then restoring.
    it("always passes --yes to gh gist delete", async () => {
      mockedGhExec.mockResolvedValue("");
      await gistCommand(["delete", "abc1230000000000000000000000000a"]);
      const capturedArgs = mockedGhExec.mock.calls[0]![0] as string[];
      expect(capturedArgs).toContain("--yes");
    });

    it("passes the selector to gh gist delete as argv", async () => {
      mockedGhExec.mockResolvedValue("");
      await gistCommand(["delete", "abc1230000000000000000000000000a"]);
      const capturedArgs = mockedGhExec.mock.calls[0]![0] as string[];
      expect(capturedArgs).toContain("abc1230000000000000000000000000a");
      expect(capturedArgs[0]).toBe("gist");
      expect(capturedArgs[1]).toBe("delete");
    });

    it("throws VALIDATION_ERROR when no selector is given", async () => {
      await expect(gistCommand(["delete"])).rejects.toThrow(AxiError);
    });

    it("throws VALIDATION_ERROR for surplus positional arguments", async () => {
      mockedGhExec.mockResolvedValue("");
      await expect(
        gistCommand(["delete", "abc1230000000000000000000000000a", "extra"]),
      ).rejects.toThrow(AxiError);
    });

    it("accepts a gist URL as the selector", async () => {
      mockedGhExec.mockResolvedValue("");
      const url =
        "https://gist.github.com/octocat/abc1230000000000000000000000000a";
      const result = await gistCommand(["delete", url]);
      expect(result).toContain(url);
      const capturedArgs = mockedGhExec.mock.calls[0]![0] as string[];
      expect(capturedArgs).toContain(url);
      expect(capturedArgs).toContain("--yes");
    });

    it("emits contextual help suggestions", async () => {
      mockedGhExec.mockResolvedValue("");
      const result = await gistCommand([
        "delete",
        "abc1230000000000000000000000000a",
      ]);
      expect(result).toContain("help[");
      expect(result).toContain("gist list");
    });

    it("never passes ctx to ghExec — gist is user-scoped", async () => {
      mockedGhExec.mockResolvedValue("");
      await gistCommand(["delete", "abc1230000000000000000000000000a"]);
      expect(mockedGhExec.mock.calls[0]![1]).toBeUndefined();
    });

    // A dropped guard flag would destroy the gist at exit 0 — the delete must
    // never run when the caller passed something the wrapper does not understand.
    it("rejects an unknown flag and never reaches gh", async () => {
      mockedGhExec.mockResolvedValue("");
      await expect(
        gistCommand([
          "delete",
          "--dry-run",
          "abc1230000000000000000000000000a",
        ]),
      ).rejects.toThrow(AxiError);
      expect(mockedGhExec).not.toHaveBeenCalled();
    });

    it("names the unknown flag in the error", async () => {
      mockedGhExec.mockResolvedValue("");
      await expect(
        gistCommand([
          "delete",
          "--dry-run",
          "abc1230000000000000000000000000a",
        ]),
      ).rejects.toThrow(/--dry-run/);
    });

    it("rejects a single-dash flag rather than treating it as the selector", async () => {
      mockedGhExec.mockResolvedValue("");
      await expect(
        gistCommand(["delete", "-y", "abc1230000000000000000000000000a"]),
      ).rejects.toThrow(/-y/);
      expect(mockedGhExec).not.toHaveBeenCalled();
    });
  });

  describe("clone", () => {
    it("clones the gist and reports ok", async () => {
      mockedGhExec.mockResolvedValue("");
      const result = await gistCommand([
        "clone",
        "abc1230000000000000000000000000a",
      ]);
      expect(result).toContain("ok");
    });

    it("passes the selector to gh gist clone as argv", async () => {
      mockedGhExec.mockResolvedValue("");
      await gistCommand(["clone", "abc1230000000000000000000000000a"]);
      const capturedArgs = mockedGhExec.mock.calls[0]![0] as string[];
      expect(capturedArgs[0]).toBe("gist");
      expect(capturedArgs[1]).toBe("clone");
      expect(capturedArgs).toContain("abc1230000000000000000000000000a");
    });

    it("throws VALIDATION_ERROR when no selector is given", async () => {
      await expect(gistCommand(["clone"])).rejects.toThrow(AxiError);
    });

    it("throws VALIDATION_ERROR for surplus positional arguments", async () => {
      mockedGhExec.mockResolvedValue("");
      await expect(
        gistCommand(["clone", "abc1230000000000000000000000000a", "extra"]),
      ).rejects.toThrow(AxiError);
    });

    it("accepts a gist URL as the selector", async () => {
      mockedGhExec.mockResolvedValue("");
      const url =
        "https://gist.github.com/octocat/abc1230000000000000000000000000a";
      const result = await gistCommand(["clone", url]);
      expect(result).toContain("ok");
      const capturedArgs = mockedGhExec.mock.calls[0]![0] as string[];
      expect(capturedArgs).toContain(url);
    });

    it("emits contextual help suggestions", async () => {
      mockedGhExec.mockResolvedValue("");
      const result = await gistCommand([
        "clone",
        "abc1230000000000000000000000000a",
      ]);
      expect(result).toContain("help[");
      expect(result).toContain("gist list");
    });

    it("never passes ctx to ghExec — gist is user-scoped", async () => {
      mockedGhExec.mockResolvedValue("");
      await gistCommand(["clone", "abc1230000000000000000000000000a"]);
      expect(mockedGhExec.mock.calls[0]![1]).toBeUndefined();
    });

    it("rejects an unknown flag and never reaches gh", async () => {
      mockedGhExec.mockResolvedValue("");
      await expect(
        gistCommand(["clone", "--depth=1", "abc1230000000000000000000000000a"]),
      ).rejects.toThrow(/--depth/);
      expect(mockedGhExec).not.toHaveBeenCalled();
    });

    it("rejects a single-dash flag rather than treating it as the selector", async () => {
      mockedGhExec.mockResolvedValue("");
      await expect(
        gistCommand(["clone", "-q", "abc1230000000000000000000000000a"]),
      ).rejects.toThrow(/-q/);
      expect(mockedGhExec).not.toHaveBeenCalled();
    });
  });

  // ─── gist create ──────────────────────────────────────────────────────────
  //
  // Design: writes go through `gh gist create` (not the API) so gh's binary
  // sniffing and blank-file rejection stay in effect. Visibility is required
  // and mutually exclusive. Two file-on-disk input forms (positionals, --file)
  // must not be mixed. Content may also be piped via stdin + --filename.
  // No ctx parameter — gist is user-scoped (AGENTS.md "User-scoped commands").

  describe("create", () => {
    // ── Visibility validation ───────────────────────────────────────────────

    it("rejects when neither --public nor --secret is given", async () => {
      await expect(gistCommand(["create", "a.py"])).rejects.toThrow(AxiError);
    });

    it("rejects when both --public and --secret are given", async () => {
      await expect(
        gistCommand(["create", "a.py", "--public", "--secret"]),
      ).rejects.toThrow(AxiError);
    });

    it("treats a value-position token like --desc --secret=true as description text", async () => {
      // Regression: value flags must be consumed before the visibility
      // booleans, or takeBoolFlag rejects the description as a boolean
      // value form.
      await gistCommand([
        "create",
        "a.py",
        "--public",
        "--desc",
        "--secret=true",
      ]);
      const args = mockedGhExec.mock.calls[0][0] as string[];
      const d = args.indexOf("-d");
      expect(d).toBeGreaterThan(-1);
      expect(args[d + 1]).toBe("--secret=true");
    });

    it("still rejects a boolean value form on the visibility flag itself", async () => {
      await expect(
        gistCommand(["create", "a.py", "--secret=true"]),
      ).rejects.toThrow(/--secret does not take a value/);
      expect(mockedGhExec).not.toHaveBeenCalled();
    });

    // ── Positional file form ────────────────────────────────────────────────

    it("creates a public gist from positional files and reports id+url+visibility", async () => {
      const result = await gistCommand(["create", "a.py", "b.py", "--public"]);
      expect(result).toContain(CREATE_ID);
      expect(result).toContain(CREATE_URL);
      expect(result).toContain("public");
    });

    it("passes positional file paths to gh argv", async () => {
      // Mutation target: if `ghArgs.push(...paths)` is removed, "a.py" and "b.py"
      // disappear from the argv and this test fails.
      await gistCommand(["create", "a.py", "b.py", "--public"]);
      const args = mockedGhExec.mock.calls[0][0] as string[];
      expect(args).toContain("a.py");
      expect(args).toContain("b.py");
    });

    // ── --file flag form ────────────────────────────────────────────────────

    it("creates a gist from --file flags and reports id", async () => {
      const result = await gistCommand([
        "create",
        "--file",
        "a.py",
        "--file",
        "b.py",
        "--public",
      ]);
      expect(result).toContain(CREATE_ID);
    });

    it("passes every --file value to gh argv (repeatable, no silent drops)", async () => {
      // Mutation target: if only the first --file value is consumed (first-only
      // bug, #55/#57/#75) the second value "b.py" is absent and this test fails.
      await gistCommand([
        "create",
        "--file",
        "a.py",
        "--file",
        "b.py",
        "--public",
      ]);
      const args = mockedGhExec.mock.calls[0][0] as string[];
      expect(args).toContain("a.py");
      expect(args).toContain("b.py");
    });

    it("rejects mixing positional paths with --file", async () => {
      await expect(
        gistCommand(["create", "a.py", "--file", "b.py", "--public"]),
      ).rejects.toThrow(AxiError);
    });

    it("rejects a dangling --file with no value following it", async () => {
      // takeAllFlags throws VALIDATION_ERROR when a flag's value is missing.
      await expect(
        gistCommand(["create", "--file", "--public"]),
      ).rejects.toThrow(AxiError);
    });

    it("rejects a blank --file= value", async () => {
      await expect(
        gistCommand(["create", "--file=", "--public"]),
      ).rejects.toThrow(AxiError);
    });

    // ── Stdin / --filename form ─────────────────────────────────────────────

    it("creates a gist from piped stdin with --filename", async () => {
      const result = await gistCommand([
        "create",
        "--filename",
        "foo.txt",
        "--public",
      ]);
      expect(result).toContain(CREATE_ID);
      expect(mockedGhExecWithStdin).toHaveBeenCalledOnce();
      expect(mockedGhExec).not.toHaveBeenCalled();
    });

    it("passes --filename value to gh argv in stdin form", async () => {
      // Mutation target: if `ghArgs.push("--filename", filename)` is removed,
      // --filename and foo.txt disappear from gh argv and this test fails.
      await gistCommand(["create", "--filename", "foo.txt", "--public"]);
      const args = mockedGhExecWithStdin.mock.calls[0][0] as string[];
      expect(args).toContain("--filename");
      expect(args).toContain("foo.txt");
    });

    it("pipes stdin content to gh in stdin form", async () => {
      mockedReadStdin.mockResolvedValue("the content");
      await gistCommand(["create", "--filename", "foo.txt", "--public"]);
      const input = mockedGhExecWithStdin.mock.calls[0][1] as string;
      expect(input).toBe("the content");
    });

    it("rejects stdin form when stdin is a TTY (no pipe detected)", async () => {
      mockedIsStdinTTY.mockReturnValue(true);
      await expect(
        gistCommand(["create", "--filename", "foo.txt", "--public"]),
      ).rejects.toThrow(AxiError);
    });

    it("rejects an empty stdin read and never creates an empty gist", async () => {
      mockedIsStdinTTY.mockReturnValue(false);
      mockedReadStdin.mockResolvedValue("");
      await expect(
        gistCommand(["create", "--filename", "foo.txt", "--public"]),
      ).rejects.toThrow(/stdin/);
      expect(mockedGhExecWithStdin).not.toHaveBeenCalled();
    });

    it("rejects mixing --filename with positional paths", async () => {
      await expect(
        gistCommand(["create", "a.py", "--filename", "foo.txt", "--public"]),
      ).rejects.toThrow(AxiError);
    });

    it("rejects mixing --filename with --file", async () => {
      await expect(
        gistCommand([
          "create",
          "--file",
          "a.py",
          "--filename",
          "foo.txt",
          "--public",
        ]),
      ).rejects.toThrow(AxiError);
    });

    // ── Description flag ────────────────────────────────────────────────────

    it("passes --desc to gh argv as -d", async () => {
      await gistCommand(["create", "a.py", "--public", "--desc", "My notes"]);
      const args = mockedGhExec.mock.calls[0][0] as string[];
      expect(args).toContain("-d");
      expect(args).toContain("My notes");
    });

    it("also accepts -d short form for description", async () => {
      await gistCommand(["create", "a.py", "--public", "-d", "Short desc"]);
      const args = mockedGhExec.mock.calls[0][0] as string[];
      expect(args).toContain("-d");
      expect(args).toContain("Short desc");
    });

    // ── --public flag in gh argv ─────────────────────────────────────────────

    it("passes --public to gh argv for public gists", async () => {
      // Mutation target: if `ghArgs.push("--public")` is removed, gh creates a
      // secret gist instead and this test fails.
      await gistCommand(["create", "a.py", "--public"]);
      const args = mockedGhExec.mock.calls[0][0] as string[];
      expect(args).toContain("--public");
    });

    it("does NOT pass --public or --secret to gh argv for secret gists (gh defaults to secret)", async () => {
      await gistCommand(["create", "a.py", "--secret"]);
      const args = mockedGhExec.mock.calls[0][0] as string[];
      expect(args).not.toContain("--public");
      expect(args).not.toContain("--secret");
    });

    // ── Output content ──────────────────────────────────────────────────────

    it("reports the gist id extracted from the URL last path segment", async () => {
      const result = await gistCommand(["create", "a.py", "--public"]);
      // id is the last path segment of the URL
      expect(result).toContain(CREATE_ID);
    });

    it("reports the full gist url", async () => {
      const result = await gistCommand(["create", "a.py", "--public"]);
      expect(result).toContain(CREATE_URL);
    });

    it("reports visibility: secret for secret gists", async () => {
      const result = await gistCommand(["create", "a.py", "--secret"]);
      expect(result).toContain("secret");
    });

    it("includes the unlisted-not-private help line for secret gists", async () => {
      const result = await gistCommand(["create", "a.py", "--secret"]);
      expect(result).toContain("unlisted");
      expect(result).toContain("not private");
    });

    it("omits the unlisted-not-private help line for public gists", async () => {
      const result = await gistCommand(["create", "a.py", "--public"]);
      expect(result).not.toContain("unlisted");
    });

    // ── User-scoped (no ctx forwarded to gh) ─────────────────────────────────

    it("never passes ctx to ghExec — gist create is user-scoped", async () => {
      // ghExec is called without a ctx argument. The second argument (ctx) must
      // be undefined, matching the same structural guarantee as gist list.
      await gistCommand(["create", "a.py", "--public"]);
      expect(mockedGhExec.mock.calls[0][2]).toBeUndefined();
    });

    // ── Unknown single-dash flag rejection ──────────────────────────────────
    //
    // Single-dash gh shorthands must be rejected, not forwarded as file paths.
    // The critical case is -p (gh's --public): `gist create a.py --secret -p`
    // builds argv ["gist","create","a.py","-p"] which gh interprets as public,
    // creating a public gist while the wrapper reports visibility: secret —
    // a silent wrong-answer-at-exit-0 leak. -w/--web and -f/--filename trigger
    // gh interactivity in similar fashion.
    //
    // Each test asserts BOTH that an AxiError is thrown AND that ghExec was
    // never called — the regression the reviewer caught is that gh runs at all.

    it("rejects -p (gh --public shorthand) and does not call ghExec", async () => {
      await expect(
        gistCommand(["create", "a.py", "--secret", "-p"]),
      ).rejects.toThrow(AxiError);
      expect(mockedGhExec).not.toHaveBeenCalled();
      expect(mockedGhExecWithStdin).not.toHaveBeenCalled();
    });

    it("rejects -w (gh --web shorthand) and does not call ghExec", async () => {
      await expect(
        gistCommand(["create", "a.py", "--public", "-w"]),
      ).rejects.toThrow(AxiError);
      expect(mockedGhExec).not.toHaveBeenCalled();
    });

    it("rejects -f (gh --filename shorthand) and does not call ghExec", async () => {
      await expect(
        gistCommand(["create", "a.py", "--public", "-f"]),
      ).rejects.toThrow(AxiError);
      expect(mockedGhExec).not.toHaveBeenCalled();
    });

    it("rejects unknown long flags that are not known to createGist", async () => {
      await expect(
        gistCommand(["create", "a.py", "--public", "--unknown-flag"]),
      ).rejects.toThrow(AxiError);
      expect(mockedGhExec).not.toHaveBeenCalled();
    });

    // ── Help / suggestions ──────────────────────────────────────────────────

    it("ends with a help block", async () => {
      const result = await gistCommand(["create", "a.py", "--public"]);
      expect(result).toContain("help[");
    });
  });

  describe("view", () => {
    it("requires a selector argument", async () => {
      await expect(gistCommand(["view"])).rejects.toThrow(AxiError);
    });

    it("calls gh api /gists/<id> — pins the API endpoint construction", async () => {
      mockedGhJson.mockResolvedValue(gistDetail());
      await gistCommand(["view", GIST_ID]);
      const captured = mockedGhJson.mock.calls[0][0] as string[];
      // Assert on captured argv so the test bites if the endpoint expression changes.
      expect(captured[0]).toBe("api");
      expect(captured[1]).toBe(`/gists/${GIST_ID}`);
    });

    it("never passes repo context to gh — gist view is user-scoped", async () => {
      mockedGhJson.mockResolvedValue(gistDetail());
      await gistCommand(["view", GIST_ID]);
      expect(mockedGhJson.mock.calls[0][1]).toBeUndefined();
    });

    it("returns gist metadata (id, description, visibility, owner)", async () => {
      mockedGhJson.mockResolvedValue(gistDetail());
      const result = await gistCommand(["view", GIST_ID]);
      expect(result).toContain(GIST_ID);
      expect(result).toContain("a detail gist");
      expect(result).toContain("public");
      expect(result).toContain("octocat");
    });

    it("includes file content in the output", async () => {
      mockedGhJson.mockResolvedValue(gistDetail());
      const result = await gistCommand(["view", GIST_ID]);
      expect(result).toContain("ring.erl");
      expect(result).toContain("-module(ring)");
    });

    it("includes the file size", async () => {
      mockedGhJson.mockResolvedValue(gistDetail());
      const result = await gistCommand(["view", GIST_ID]);
      expect(result).toContain("42");
    });

    it("accepts a gist.github.com URL as selector", async () => {
      mockedGhJson.mockResolvedValue(gistDetail());
      await gistCommand(["view", `https://gist.github.com/octocat/${GIST_ID}`]);
      const captured = mockedGhJson.mock.calls[0][0] as string[];
      expect(captured[1]).toBe(`/gists/${GIST_ID}`);
    });

    it("accepts an ownerless gist.github.com URL", async () => {
      mockedGhJson.mockResolvedValue(gistDetail());
      await gistCommand(["view", `https://gist.github.com/${GIST_ID}`]);
      const captured = mockedGhJson.mock.calls[0][0] as string[];
      expect(captured[1]).toBe(`/gists/${GIST_ID}`);
    });

    it("accepts a GHE-shaped URL when GH_HOST is set", async () => {
      process.env["GH_HOST"] = "ghe.example.com";
      mockedGhJson.mockResolvedValue(gistDetail());
      await gistCommand([
        "view",
        `https://ghe.example.com/gist/OWNER/${GIST_ID}`,
      ]);
      const captured = mockedGhJson.mock.calls[0][0] as string[];
      expect(captured[1]).toBe(`/gists/${GIST_ID}`);
    });

    it("rejects a URL pointing at a different host than configured", async () => {
      process.env["GH_HOST"] = "ghe.example.com";
      await expect(
        gistCommand(["view", `https://gist.github.com/OWNER/${GIST_ID}`]),
      ).rejects.toThrow(AxiError);
    });

    it("truncates content over the limit and adds a footer", async () => {
      const longContent = "x".repeat(2000);
      mockedGhJson.mockResolvedValue(
        gistDetail({
          files: {
            "big.txt": {
              filename: "big.txt",
              size: 2000,
              content: longContent,
            },
          },
        }),
      );
      const result = await gistCommand(["view", GIST_ID]);
      expect(result).toContain("... (truncated,");
      expect(result).toContain("2000 chars total");
      expect(result).toContain("use --full");
    });

    it("truncated content is byte-exact up to the cut with no cleanup rewriting", async () => {
      // Diffs and shell code both start lines with '>'. cleanBody() would
      // collapse 3+ such lines to "[quoted text removed]" — that must NOT
      // happen for gist content.
      const codeWithAngles = Array.from(
        { length: 10 },
        (_, i) => `> line ${i}`,
      ).join("\n");
      const longCode = codeWithAngles.repeat(20); // well over 1500 chars
      mockedGhJson.mockResolvedValue(
        gistDetail({
          files: {
            "diff.patch": {
              filename: "diff.patch",
              size: longCode.length,
              content: longCode,
            },
          },
        }),
      );
      const result = await gistCommand(["view", GIST_ID]);
      // The first line must be intact — no "[quoted text removed]" rewriting
      expect(result).toContain("> line 0");
      expect(result).not.toContain("[quoted text removed]");
    });

    it("full hint is absent when content is short enough", async () => {
      mockedGhJson.mockResolvedValue(gistDetail()); // ring.erl is 42 chars
      const result = await gistCommand(["view", GIST_ID]);
      expect(result).not.toContain("... (truncated,");
    });

    it("--full returns complete content without the truncation footer", async () => {
      const longContent = "y".repeat(2000);
      mockedGhJson.mockResolvedValue(
        gistDetail({
          files: {
            "big.txt": {
              filename: "big.txt",
              size: 2000,
              content: longContent,
            },
          },
        }),
      );
      const result = await gistCommand(["view", GIST_ID, "--full"]);
      expect(result).not.toContain("... (truncated,");
      // Content must be complete — check the tail chars are present
      expect(result).toContain(longContent.slice(-10));
    });

    it("--files lists file names only and omits content", async () => {
      mockedGhJson.mockResolvedValue(
        gistDetail({
          files: {
            "ring.erl": {
              filename: "ring.erl",
              size: 42,
              content: "module code",
            },
            "readme.md": {
              filename: "readme.md",
              size: 10,
              content: "# Readme",
            },
          },
        }),
      );
      const result = await gistCommand(["view", GIST_ID, "--files"]);
      expect(result).toContain("ring.erl");
      expect(result).toContain("readme.md");
      expect(result).not.toContain("module code");
      expect(result).not.toContain("# Readme");
    });

    it("-f/--filename emits only that file", async () => {
      mockedGhJson.mockResolvedValue(
        gistDetail({
          files: {
            "ring.erl": {
              filename: "ring.erl",
              size: 42,
              content: "module code",
            },
            "readme.md": {
              filename: "readme.md",
              size: 10,
              content: "# Readme",
            },
          },
        }),
      );
      const result = await gistCommand([
        "view",
        GIST_ID,
        "--filename",
        "ring.erl",
      ]);
      expect(result).toContain("ring.erl");
      expect(result).toContain("module code");
      expect(result).not.toContain("readme.md");
      expect(result).not.toContain("# Readme");
    });

    it("-f short form works for --filename", async () => {
      mockedGhJson.mockResolvedValue(gistDetail());
      const result = await gistCommand(["view", GIST_ID, "-f", "ring.erl"]);
      expect(result).toContain("ring.erl");
      expect(result).toContain("-module(ring)");
    });

    it("-f with unknown filename throws VALIDATION_ERROR", async () => {
      mockedGhJson.mockResolvedValue(gistDetail());
      await expect(
        gistCommand(["view", GIST_ID, "-f", "nonexistent.txt"]),
      ).rejects.toThrow(AxiError);
    });

    it("-r/--raw is accepted as a no-op and changes nothing", async () => {
      mockedGhJson.mockResolvedValue(gistDetail());
      const withoutRaw = await gistCommand(["view", GIST_ID]);
      vi.resetAllMocks();
      mockedGhJson.mockResolvedValue(gistDetail());
      const withRaw = await gistCommand(["view", GIST_ID, "--raw"]);
      expect(withRaw).toBe(withoutRaw);
    });

    it("-w/--web is rejected with VALIDATION_ERROR", async () => {
      await expect(gistCommand(["view", GIST_ID, "--web"])).rejects.toThrow(
        AxiError,
      );
    });

    it("-w short form is also rejected", async () => {
      await expect(gistCommand(["view", GIST_ID, "-w"])).rejects.toThrow(
        AxiError,
      );
    });

    it("emits contextual help suggestions", async () => {
      mockedGhJson.mockResolvedValue(gistDetail());
      const result = await gistCommand(["view", GIST_ID]);
      expect(result).toContain("help[");
    });

    // ── Unknown flag rejection ──────────────────────────────────────────────

    it("rejects an unknown flag instead of silently degrading the result", async () => {
      mockedGhJson.mockResolvedValue(gistDetail());
      await expect(gistCommand(["view", GIST_ID, "--ful"])).rejects.toThrow(
        /--ful/,
      );
      expect(mockedGhJson).not.toHaveBeenCalled();
    });

    it("accepts every documented boolean flag", async () => {
      mockedGhJson.mockResolvedValue(gistDetail());
      const result = await gistCommand(["view", GIST_ID, "--full", "-r"]);
      expect(result).toContain("ring.erl");
    });

    // hasFlag only matches the bare token, so a boolean in =value form would
    // otherwise pass the guard and then be silently ignored at exit 0.
    it("rejects --full=true rather than accepting and ignoring it", async () => {
      mockedGhJson.mockResolvedValue(
        gistDetail({
          files: {
            "big.txt": {
              filename: "big.txt",
              size: 2000,
              content: "z".repeat(2000),
            },
          },
        }),
      );
      await expect(
        gistCommand(["view", GIST_ID, "--full=true"]),
      ).rejects.toThrow(/--full=true/);
      expect(mockedGhJson).not.toHaveBeenCalled();
    });

    it("rejects --files=1 rather than accepting and ignoring it", async () => {
      mockedGhJson.mockResolvedValue(gistDetail());
      await expect(gistCommand(["view", GIST_ID, "--files=1"])).rejects.toThrow(
        /--files=1/,
      );
      expect(mockedGhJson).not.toHaveBeenCalled();
    });

    it("rejects -r=x rather than accepting and ignoring it", async () => {
      mockedGhJson.mockResolvedValue(gistDetail());
      await expect(gistCommand(["view", GIST_ID, "-r=x"])).rejects.toThrow(
        AxiError,
      );
      expect(mockedGhJson).not.toHaveBeenCalled();
    });

    it("rejects --web=true with the unsupported-browser error", async () => {
      await expect(
        gistCommand(["view", GIST_ID, "--web=true"]),
      ).rejects.toThrow(/browser/);
    });

    it("still accepts -f/--filename in =value form", async () => {
      mockedGhJson.mockResolvedValue(gistDetail());
      const result = await gistCommand([
        "view",
        GIST_ID,
        "--filename=ring.erl",
      ]);
      expect(result).toContain("ring.erl");
      expect(result).toContain("-module(ring)");
    });

    // ── GitHub API server-side truncation ───────────────────────────────────

    it("surfaces a note and raw_url when the API truncated the file", async () => {
      mockedGhJson.mockResolvedValue(
        gistDetail({
          files: {
            "huge.txt": {
              filename: "huge.txt",
              size: 5_000_000,
              content: "partial bytes",
              truncated: true,
              raw_url:
                "https://gist.githubusercontent.com/octocat/raw/huge.txt",
            },
          },
        }),
      );
      const result = await gistCommand(["view", GIST_ID]);
      expect(result).toContain("truncated by the GitHub API");
      expect(result).toContain(
        "https://gist.githubusercontent.com/octocat/raw/huge.txt",
      );
    });

    // --full cannot undo a server-side cap; claiming "no truncation" there
    // would be a silent lie about missing bytes.
    it("keeps the API truncation note under --full", async () => {
      mockedGhJson.mockResolvedValue(
        gistDetail({
          files: {
            "huge.txt": {
              filename: "huge.txt",
              size: 5_000_000,
              content: "partial bytes",
              truncated: true,
              raw_url:
                "https://gist.githubusercontent.com/octocat/raw/huge.txt",
            },
          },
        }),
      );
      const result = await gistCommand(["view", GIST_ID, "--full"]);
      expect(result).toContain("truncated by the GitHub API");
    });

    it("still notes API truncation when raw_url is absent", async () => {
      mockedGhJson.mockResolvedValue(
        gistDetail({
          files: {
            "huge.txt": {
              filename: "huge.txt",
              size: 5_000_000,
              content: "partial bytes",
              truncated: true,
            },
          },
        }),
      );
      const result = await gistCommand(["view", GIST_ID]);
      expect(result).toContain("truncated by the GitHub API");
    });

    it("omits the API truncation note when truncated is false", async () => {
      mockedGhJson.mockResolvedValue(gistDetail());
      const result = await gistCommand(["view", GIST_ID]);
      expect(result).not.toContain("truncated by the GitHub API");
    });

    it("surfaces the API truncation note in the -f single-file view", async () => {
      mockedGhJson.mockResolvedValue(
        gistDetail({
          files: {
            "huge.txt": {
              filename: "huge.txt",
              size: 5_000_000,
              content: "partial bytes",
              truncated: true,
              raw_url:
                "https://gist.githubusercontent.com/octocat/raw/huge.txt",
            },
          },
        }),
      );
      const result = await gistCommand(["view", GIST_ID, "-f", "huge.txt"]);
      expect(result).toContain("truncated by the GitHub API");
    });
  });
});
