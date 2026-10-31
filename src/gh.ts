import { execFile } from "node:child_process";
import { ATTACH_MIN_GH_VERSION } from "./attach.js";
import { type RepoContext } from "./context.js";
import { debugArgv } from "./debug.js";
import { isRepositoryMetadataRequest } from "./repoMetadata.js";
import {
  AttachmentMutationError,
  AxiError,
  ghNotInstalledError,
  mapGhError,
  RepositoryMetadataError,
} from "./errors.js";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
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

/**
 * How long gh must keep running after a stderr chunk before that chunk is
 * forwarded live. A notice from a pending request (an approval prompt) outlives
 * it. The error or warning gh writes as it exits does not, so it is only
 * retained: a failure reports it once in the structured error, and a call that
 * succeeds, such as an internal fallback attempt, drops it.
 */
const PENDING_STDERR_MS = 1000;

/** Stream gh diagnostics live while it is pending, retaining both streams for result handling. */
function run(
  args: string[],
  ctx?: RepoContext,
  input?: string,
): Promise<ExecResult> {
  const argv = [...args];
  const repositoryMetadata = isRepositoryMetadataRequest(args);
  let env: NodeJS.ProcessEnv | undefined;
  // Pass a flag/env repo context on (gh auto-detects a git remote itself).
  // `gh api` rejects --repo but fills its {owner}/{repo} placeholders from
  // GH_REPO, so an api call gets the repo there instead.
  if (ctx && ctx.source !== "git") {
    if (args[0] === "api") env = { ...process.env, GH_REPO: ctx.nwo };
    else argv.push("--repo", ctx.nwo);
  }
  debugArgv(argv);
  return new Promise((resolve) => {
    const held = new Set<ReturnType<typeof setTimeout>>();
    const settle = toExecResult((result) => {
      // Upstream debugging/error bodies may contain the original repository
      // tokens, even when gh's stdout jq filter has already removed them.
      if (repositoryMetadata && result.stderr !== "ENOENT") {
        resolve({
          stdout: result.exitCode === 0 ? result.stdout : "",
          stderr:
            result.exitCode === 0
              ? ""
              : new RepositoryMetadataError(result.exitCode).message,
          exitCode: result.exitCode,
        });
      } else resolve(result);
    });
    const child = execFile(
      resolveGhBin(),
      argv,
      { maxBuffer: MAX_BUFFER_BYTES, env },
      (error, stdout, stderr) => {
        for (const timer of held) clearTimeout(timer);
        settle(error, stdout, stderr);
      },
    );
    child.stderr?.on("data", (chunk: Buffer | string) => {
      // Do not stream even partial/chunked metadata diagnostics: field names
      // and values can span chunks, so text-based redaction is not safe.
      if (repositoryMetadata) return;
      // Timers with equal delays fire in creation order, so chunks stay ordered.
      const timer = setTimeout(() => {
        held.delete(timer);
        process.stderr.write(chunk);
      }, PENDING_STDERR_MS);
      held.add(timer);
    });
    if (input !== undefined) child.stdin?.end(input);
  });
}

/** Execute gh and return parsed JSON. */
export async function ghJson<T = unknown>(
  args: string[],
  ctx?: RepoContext,
): Promise<T> {
  const result = await run(args, ctx);
  if (result.stderr === "ENOENT") throw missingGhError();
  if (result.exitCode !== 0) {
    throw isRepositoryMetadataRequest(args)
      ? new RepositoryMetadataError(result.exitCode)
      : mapGhError(result.stderr, result.exitCode);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    if (isRepositoryMetadataRequest(args)) throw new RepositoryMetadataError(1);
    throw new AxiError(
      `Unexpected gh output: ${result.stdout.slice(0, 200)}`,
      "UNKNOWN",
    );
  }
}

function versionAtLeast(actual: number[], required: number[]): boolean {
  for (let index = 0; index < required.length; index++) {
    if ((actual[index] ?? 0) > required[index]) return true;
    if ((actual[index] ?? 0) < required[index]) return false;
  }
  return true;
}

export async function ensureAttachmentSupport(): Promise<void> {
  const result = await run(["--version"]);
  if (result.stderr === "ENOENT") throw missingGhError();
  if (result.exitCode !== 0) throw mapGhError(result.stderr, result.exitCode);

  const installed = result.stdout.match(/gh version (\d+)\.(\d+)\.(\d+)/);
  if (!installed) {
    throw new AxiError(
      `Could not determine installed gh version; --attach requires gh ${ATTACH_MIN_GH_VERSION}+`,
      "VALIDATION_ERROR",
    );
  }

  const actual = installed.slice(1).map(Number);
  const required = ATTACH_MIN_GH_VERSION.split(".").map(Number);
  const supported = versionAtLeast(actual, required);
  if (!supported) {
    throw new AxiError(
      `--attach requires gh ${ATTACH_MIN_GH_VERSION}+; installed gh ${installed[1]}.${installed[2]}.${installed[3]}`,
      "VALIDATION_ERROR",
      [
        `Upgrade gh to ${ATTACH_MIN_GH_VERSION} or newer`,
        `Or point GH_BIN at a ${ATTACH_MIN_GH_VERSION}+ gh binary`,
      ],
    );
  }
}

/** Execute gh and return raw stdout. */
export async function ghExec(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const result = await run(args, ctx);
  if (result.stderr === "ENOENT") throw missingGhError();
  if (result.exitCode !== 0) {
    // Some gh subcommands (e.g. `run watch --exit-status` on a completed
    // failed run) write their failure diagnostics to stdout and leave stderr
    // empty, so fall back to stdout to keep the actionable output visible.
    // gh writes progress lines first and the failure summary at the end of
    // the stream, so the fallback takes the last non-empty stdout line.
    throw isRepositoryMetadataRequest(args)
      ? new RepositoryMetadataError(result.exitCode)
      : mapGhError(
          result.stderr || lastNonEmptyLine(result.stdout),
          result.exitCode,
        );
  }
  return result.stdout;
}

function lastNonEmptyLine(text: string): string {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  return lines[lines.length - 1] ?? "";
}

export async function ghExecWithAttachmentState(
  args: string[],
  ctx?: RepoContext,
): Promise<string> {
  const result = await run(args, ctx);
  if (result.stderr === "ENOENT") throw missingGhError();
  if (result.exitCode !== 0) {
    const error = isRepositoryMetadataRequest(args)
      ? new RepositoryMetadataError(result.exitCode)
      : mapGhError(result.stderr, result.exitCode);
    const mutationUrl = result.stdout.match(/https?:\/\/[^\s]+/)?.[0];
    if (!mutationUrl) throw error;
    throw new AttachmentMutationError(result.stdout, mutationUrl, error);
  }
  return result.stdout;
}

/** Execute gh, returning stdout + stderr without throwing on non-zero exit. */
export async function ghRaw(
  args: string[],
  ctx?: RepoContext,
): Promise<ExecResult> {
  const result = await run(args, ctx);
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
  const result = await run(args, ctx, input);
  if (result.stderr === "ENOENT") throw missingGhError();
  if (result.exitCode !== 0) {
    throw isRepositoryMetadataRequest(args)
      ? new RepositoryMetadataError(result.exitCode)
      : mapGhError(result.stderr, result.exitCode);
  }
  return result.stdout;
}
