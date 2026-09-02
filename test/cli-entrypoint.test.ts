import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main, TOP_HELP } from "../src/cli.js";
import { withPng } from "./helpers/media.js";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(),
}));

const packageVersion = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
) as { version: string };

const mockedExecFile = vi.mocked(execFile);
const mockedExecFileSync = vi.mocked(execFileSync);

type ExecFileCallback = (
  error: Error | null,
  stdout: string,
  stderr: string,
) => void;

function createStdout() {
  let output = "";

  return {
    stdout: {
      write(chunk: string) {
        output += chunk;
      },
    },
    read() {
      return output;
    },
  };
}

async function withBodyFile<T>(
  body: string,
  fn: (file: string) => Promise<T>,
): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "gh-axi-cli-body-"));
  try {
    const file = join(dir, "body.md");
    writeFileSync(file, body, "utf8");
    return await fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("CLI entrypoint", () => {
  const previousBin = process.env["GH_BIN"];

  beforeEach(() => {
    mockedExecFile.mockReset();
    mockedExecFileSync.mockReset();
    delete process.env["GH_BIN"];
  });

  afterEach(() => {
    process.exitCode = undefined;
    if (previousBin === undefined) delete process.env["GH_BIN"];
    else process.env["GH_BIN"] = previousBin;
  });

  it("prints top-level help through the real runtime", async () => {
    const output = createStdout();

    await main({ argv: ["--help"], stdout: output.stdout });

    // The runtime renders TOP_HELP, then the SDK appends the inherited
    // built-in commands (the self-update `update` command).
    const rendered = output.read();
    expect(rendered.startsWith(TOP_HELP)).toBe(true);
    expect(rendered).toContain('"built-in":');
    expect(rendered).toContain("update --check");
  });

  it.each(["-v", "-V", "--version"])(
    "prints %s through the real runtime",
    async (flag) => {
      const output = createStdout();

      await main({ argv: [flag], stdout: output.stdout });

      expect(output.read()).toBe(`${packageVersion.version}\n`);
    },
  );

  it("posts pr comment --body-file contents through the real runtime", async () => {
    const body = "review\n```ts\nconst ok = true;\n```\nIt's ready.";

    await withBodyFile(body, async (file) => {
      mockedExecFileSync.mockReturnValue("https://github.com/octo/repo.git\n");
      mockedExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
        (callback as ExecFileCallback)(null, "", "");
        return {} as ReturnType<typeof execFile>;
      });
      const output = createStdout();

      await main({
        argv: ["pr", "comment", "123", "--body-file", file],
        stdout: output.stdout,
      });

      expect(mockedExecFile).toHaveBeenCalledWith(
        "gh",
        ["pr", "comment", "123", "--body", body],
        expect.any(Object),
        expect.any(Function),
      );
      expect(output.read()).toContain("commented");
    });
  });

  it("rejects old gh before inspecting attachment inputs", async () => {
    mockedExecFileSync.mockReturnValue("https://github.com/octo/repo.git\n");
    mockedExecFile.mockImplementation((_cmd, args, _opts, callback) => {
      expect(args).toEqual(["--version"]);
      (callback as ExecFileCallback)(
        null,
        "gh version 2.98.0 (2026-03-18)\n",
        "",
      );
      return {} as ReturnType<typeof execFile>;
    });
    const output = createStdout();

    await main({
      argv: [
        "issue",
        "create",
        "--title",
        "UI bug",
        "--attach",
        "./missing.png",
      ],
      stdout: output.stdout,
    });

    expect(output.read()).toContain(
      "--attach requires gh 2.99.0+; installed gh 2.98.0",
    );
    expect(mockedExecFile).toHaveBeenCalledTimes(1);
  });

  it("forwards raw attachment values to gh validation", async () => {
    mockedExecFileSync.mockReturnValue("https://github.com/octo/repo.git\n");
    mockedExecFile.mockImplementation((_cmd, args, _opts, callback) => {
      const argv = args as string[];
      if (argv[0] === "--version") {
        (callback as ExecFileCallback)(
          null,
          "gh version 2.99.0 (2026-04-01)\n",
          "",
        );
      } else {
        expect(argv).toEqual([
          "issue",
          "create",
          "--title",
          "UI bug",
          "--body",
          "",
          "--attach",
          "#alt",
        ]);
        const error = new Error("exit 1") as Error & { code: number };
        error.code = 1;
        (callback as ExecFileCallback)(
          error,
          "",
          "#alt: no such file or directory",
        );
      }
      return {} as ReturnType<typeof execFile>;
    });
    const output = createStdout();

    await main({
      argv: ["issue", "create", "--title", "UI bug", "--attach", "#alt"],
      stdout: output.stdout,
    });

    expect(output.read()).toContain("#alt: no such file or directory");
    expect(mockedExecFile).toHaveBeenCalledTimes(2);
  });

  it("reports partial-upload asset URLs alongside the failure", async () => {
    await withPng(async (file) => {
      const assetUrl =
        "https://github.com/user-attachments/assets/partial-0000-0000-000000000001";
      mockedExecFileSync.mockReturnValue("https://github.com/octo/repo.git\n");
      mockedExecFile.mockImplementation((_cmd, args, _opts, callback) => {
        const argv = args as string[];
        if (argv[0] === "--version") {
          (callback as ExecFileCallback)(
            null,
            "gh version 2.99.0 (2026-04-01)\n",
            "",
          );
        } else if (argv[0] === "issue" && argv[1] === "create") {
          const error = new Error("exit 1") as Error & { code: number };
          error.code = 1;
          (callback as ExecFileCallback)(
            error,
            "https://github.com/octo/repo/issues/99\n",
            "oversized.png: images must be at most 10.0 MB",
          );
        } else {
          (callback as ExecFileCallback)(
            null,
            JSON.stringify({
              number: 99,
              title: "UI bug",
              state: "OPEN",
              url: "https://github.com/octo/repo/issues/99",
              body: `![uploaded](${assetUrl})`,
            }),
            "",
          );
        }
        return {} as ReturnType<typeof execFile>;
      });
      const output = createStdout();

      await main({
        argv: [
          "issue",
          "create",
          "--title",
          "UI bug",
          "--attach",
          file,
          "--attach",
          "oversized.png",
        ],
        stdout: output.stdout,
      });

      const rendered = output.read();
      expect(rendered).toContain("attachment_operation: failed");
      expect(rendered).toContain("asset_urls");
      expect(rendered).toContain(assetUrl);
      expect(rendered).toContain("images must be at most 10.0 MB");
    });
  });

  it("posts issue create --attach through the real runtime and names asset URLs", async () => {
    await withPng(async (file) => {
      const assetUrl =
        "https://github.com/user-attachments/assets/deadbeef-0000-0000-0000-000000000001";
      mockedExecFileSync.mockReturnValue("https://github.com/octo/repo.git\n");
      mockedExecFile.mockImplementation((_cmd, args, _opts, callback) => {
        const argv = args as string[];
        if (argv[0] === "--version") {
          (callback as ExecFileCallback)(
            null,
            "gh version 2.99.0 (2026-04-01)\n",
            "",
          );
        } else if (argv[0] === "issue" && argv[1] === "create") {
          (callback as ExecFileCallback)(
            null,
            "https://github.com/octo/repo/issues/99\n",
            "",
          );
        } else {
          (callback as ExecFileCallback)(
            null,
            JSON.stringify({
              number: 99,
              title: "UI bug",
              state: "OPEN",
              url: "https://github.com/octo/repo/issues/99",
              body: `![repro](${assetUrl})\n![repro again](${assetUrl})`,
            }),
            "",
          );
        }
        return {} as ReturnType<typeof execFile>;
      });
      const output = createStdout();

      await main({
        argv: ["issue", "create", "--title", "UI bug", "--attach", file],
        stdout: output.stdout,
      });

      expect(mockedExecFile).toHaveBeenCalledWith(
        "gh",
        [
          "issue",
          "create",
          "--title",
          "UI bug",
          "--body",
          "",
          "--attach",
          file,
        ],
        expect.any(Object),
        expect.any(Function),
      );
      const rendered = output.read();
      expect(rendered).toContain("attachments");
      expect(rendered).toContain(file);
      expect(rendered).toContain(assetUrl);
      expect(rendered.split(assetUrl)).toHaveLength(2);
    });
  });
});
