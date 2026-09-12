import { readFileSync } from "node:fs";
import { isatty } from "node:tty";

/**
 * Read all of this process's piped stdin synchronously as a UTF-8 string.
 * Callers must check `isStdinTTY()` first so an interactive shell never blocks.
 */
export function readStdinSync(): string {
  return readFileSync(0, "utf8");
}

/** Read all of this process's stdin as a UTF-8 string. */
export function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

/**
 * Whether stdin is an interactive terminal (no piped input available).
 * Checks fd 0 directly: touching `process.stdin` wraps a pipe in a socket that
 * switches it to non-blocking, so a later `readStdinSync()` could hit EAGAIN.
 */
export function isStdinTTY(): boolean {
  return isatty(0);
}
