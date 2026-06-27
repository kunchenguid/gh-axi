import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main, TOP_HELP } from "../src/cli.js";

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
  beforeEach(() => {
    mockedExecFile.mockReset();
    mockedExecFileSync.mockReset();
  });

  afterEach(() => {
    process.exitCode = undefined;
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
});
