import { execFile } from "node:child_process";
import { type RepoContext } from "./context.js";
import { AxiError, ghNotInstalledError, mapGhError } from "./errors.js";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function buildArgs(args: string[], ctx?: RepoContext): string[] {
  const out = [...args];
  // Append --repo for flag/env sources (git remote is auto-detected by gh)
  if (ctx && ctx.source !== "git") {
    out.push("--repo", ctx.nwo);
  }
  return out;
}

const MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10 MB

/** Override the wrapped `gh` binary. Unset or blank keeps PATH lookup (`gh`). */
export function resolveGhBin(): string {
  const fromEnv = process.env["GH_BIN"]?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : "gh";
}

function missingGhError(): AxiError {
  const overridden = process.env["GH_BIN"]?.trim();
  if (overridden) {
    return new AxiError(
      `GH_BIN is not an executable gh binary: ${overridden}`,
      "GH_NOT_INSTALLED",
    );
  }
  return ghNotInstalledError();
}

function toExecResult(
  resolve: (result: ExecResult) => void,
): (error: Error | null, stdout: string, stderr: string) => void {
  return (error, stdout, stderr) => {
    if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      resolve({ stdout: "", stderr: "ENOENT", exitCode: 127 });
      return;
    }
    const exitCode = error
      ? ((error as Error & { code?: string | number }).code ?? 1)
      : 0;
    resolve({
      stdout: stdout ?? "",
      stderr: stderr ?? "",
      exitCode: typeof exitCode === "number" ? exitCode : 1,
    });
  };
}

function run(args: string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      resolveGhBin(),
      args,
      { maxBuffer: MAX_BUFFER_BYTES },
      toExecResult(resolve),
    );
  });
}

/** Run gh, writing `input` to the child process's stdin instead of the CLI's own. */
function runWithStdin(args: string[], input: string): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = execFile(
      resolveGhBin(),
      args,
      { maxBuffer: MAX_BUFFER_BYTES },
      toExecResult(resolve),
    );
    child.stdin?.end(input);
  });
}

/** Execute gh and return parsed JSON. */
export async function ghJson<T = unknown>(
  args: string[],
  ctx?: RepoContext,
): Promise<T> {
  const result = await run(buildArgs(args, ctx));
  if (result.stderr === "ENOENT") throw missingGhError();
  if (result.exitCode !== 0) throw mapGhError(result.stderr, result.exitCode);
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new AxiError(
      `Unexpected gh output: ${result.stdout.slice(0, 200)}`,
      "UNKNOWN",
    );
  }
}

/** Execute gh and return raw stdout. */
export async function ghExec(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const result = await run(buildArgs(args, ctx));
  if (result.stderr === "ENOENT") throw missingGhError();
  if (result.exitCode !== 0) throw mapGhError(result.stderr, result.exitCode);
  return result.stdout;
}

export async function ghExecWithAttachmentState(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const result = await run(buildArgs(args, ctx));
  if (result.stderr === "ENOENT") throw missingGhError();
  if (result.exitCode !== 0) {
    const error = mapGhError(result.stderr, result.exitCode);
    const mutationUrl = result.stdout.match(/https?:\/\/[^\s]+/)?.[0];
    if (!mutationUrl) throw error;
    throw new AxiError(
      `Mutation succeeded at ${mutationUrl}, but attachment upload failed: ${error.message}`,
      error.code,
      [
        `Do not retry the mutation; inspect ${mutationUrl} before uploading missing attachments`,
        ...error.suggestions,
      ],
    );
  }
  return result.stdout;
}

/** Execute gh, returning stdout + stderr without throwing on non-zero exit. */
export async function ghRaw(
  args: string[],
  ctx?: RepoContext,
): Promise<ExecResult> {
  const result = await run(buildArgs(args, ctx));
  if (result.stderr === "ENOENT") throw missingGhError();
  return result;
}

/**
 * Execute gh, writing `input` to the child's stdin instead of a CLI flag.
 * Keeps sensitive values (secret/variable bodies) out of the argv gh receives.
 */
export async function ghExecWithStdin(
  args: string[],
  input: string,
  ctx?: RepoContext,
): Promise<string> {
  const result = await runWithStdin(buildArgs(args, ctx), input);
  if (result.stderr === "ENOENT") throw missingGhError();
  if (result.exitCode !== 0) throw mapGhError(result.stderr, result.exitCode);
  return result.stdout;
}
