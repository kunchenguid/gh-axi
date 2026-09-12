import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import type { Writable } from "node:stream";
import { isatty } from "node:tty";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, afterEach } from "vitest";
import { readStdin, isStdinTTY } from "../src/stdin.js";

vi.mock("node:tty", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:tty")>();
  return { ...actual, isatty: vi.fn(actual.isatty) };
});

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const stdinModuleUrl = new URL("../src/stdin.ts", import.meta.url).href;

async function writeSlowly(stream: Writable, chunks: string[]): Promise<void> {
  for (const chunk of chunks) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    stream.write(chunk);
  }
  stream.end();
}

/**
 * Run isStdinTTY() then readStdinSync() in a real child process whose stdin
 * is a pipe that only receives data after the child is already reading.
 */
function runPipedChild(
  chunks: string[],
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const script = [
    `const { isStdinTTY, readStdinSync } = await import(${JSON.stringify(stdinModuleUrl)});`,
    "const tty = isStdinTTY();",
    'process.stderr.write("ready\\n");',
    "process.stdout.write(JSON.stringify({ tty, body: readStdinSync() }));",
  ].join("\n");

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      { cwd: repoRoot, stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    let started = false;
    child.stdin.on("error", () => {});
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (!started && stderr.includes("ready\n")) {
        started = true;
        void writeSlowly(child.stdin, chunks);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code }));
  });
}

describe("isStdinTTY", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true when fd 0 is an interactive terminal", () => {
    vi.mocked(isatty).mockReturnValueOnce(true);

    expect(isStdinTTY()).toBe(true);
    expect(isatty).toHaveBeenCalledWith(0);
  });

  it("does not initialize process.stdin", () => {
    const stdinGetter = vi.spyOn(process, "stdin", "get");

    isStdinTTY();

    expect(stdinGetter).not.toHaveBeenCalled();
  });

  it("returns false for a pipe and leaves it readable by readStdinSync", async () => {
    const result = await runPipedChild(["first chunk\n", "second chunk\n"]);

    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      tty: false,
      body: "first chunk\nsecond chunk\n",
    });
  }, 20_000);
});

describe("readStdin", () => {
  it("resolves with all data written before end", async () => {
    const fakeStdin = new EventEmitter() as unknown as NodeJS.ReadStream;
    (fakeStdin as unknown as { setEncoding: () => void }).setEncoding = vi.fn();
    vi.spyOn(process, "stdin", "get").mockReturnValue(fakeStdin);

    const promise = readStdin();
    fakeStdin.emit("data", "hello ");
    fakeStdin.emit("data", "world");
    fakeStdin.emit("end");

    await expect(promise).resolves.toBe("hello world");
    vi.restoreAllMocks();
  });

  it("rejects on stream error", async () => {
    const fakeStdin = new EventEmitter() as unknown as NodeJS.ReadStream;
    (fakeStdin as unknown as { setEncoding: () => void }).setEncoding = vi.fn();
    vi.spyOn(process, "stdin", "get").mockReturnValue(fakeStdin);

    const promise = readStdin();
    const err = new Error("broken pipe");
    fakeStdin.emit("error", err);

    await expect(promise).rejects.toThrow("broken pipe");
    vi.restoreAllMocks();
  });
});
