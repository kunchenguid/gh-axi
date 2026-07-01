import { EventEmitter } from "node:events";
import { describe, it, expect, vi, afterEach } from "vitest";
import { readStdin, isStdinTTY } from "../src/stdin.js";

describe("isStdinTTY", () => {
  const originalIsTTY = process.stdin.isTTY;

  afterEach(() => {
    process.stdin.isTTY = originalIsTTY;
  });

  it("returns true when stdin.isTTY is true", () => {
    process.stdin.isTTY = true;
    expect(isStdinTTY()).toBe(true);
  });

  it("returns false when stdin.isTTY is undefined (piped)", () => {
    process.stdin.isTTY = undefined as unknown as true;
    expect(isStdinTTY()).toBe(false);
  });
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
