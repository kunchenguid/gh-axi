import { execFile } from "node:child_process";
import { type ProjectContext } from "./context.js";
import { AxiError, glabNotInstalledError, mapGlabError } from "./errors.js";

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * glab auto-detects the project from the git remote of the current checkout,
 * like gh. For flag/env sources there is no checkout context to detect, so an
 * explicit -R (full project path) must reach the child.
 */
function buildArgs(args: string[], ctx?: ProjectContext): string[] {
  const out = [...args];
  if (ctx && ctx.source !== "git") {
    out.push("-R", ctx.fullPath);
  }
  return out;
}

const MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10 MB

/** Override the wrapped `glab` binary. Unset or blank keeps PATH lookup (`glab`). */
export function resolveGlabBin(): string {
  const fromEnv = process.env["GLAB_BIN"]?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : "glab";
}

function missingGlabError(): AxiError {
  const overridden = process.env["GLAB_BIN"]?.trim();
  if (overridden) {
    return new AxiError(
      `GLAB_BIN is not an executable glab binary: ${overridden}`,
      "GLAB_NOT_INSTALLED",
    );
  }
  return glabNotInstalledError();
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

function run(args: string[], stdin?: string): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = execFile(
      resolveGlabBin(),
      args,
      { maxBuffer: MAX_BUFFER_BYTES },
      toExecResult(resolve),
    );
    // glab reads standard input for `--input -` and `--field k=@-`; relay the
    // caller's body when there is one, and always close the pipe so a child
    // that reads stdin cannot wait for input that never arrives.
    child.stdin?.end(stdin ?? "");
  });
}

/** The glab invocation an error belongs to, as "<family> <subcommand>". */
function invocation(args: string[]): string {
  return args.slice(0, 2).join(" ");
}

/**
 * Execute glab and return parsed JSON.
 *
 * glab has no gh-style field selector: machine-readable output comes from
 * `-F json` (or `-O json` on commands whose `-F` means something else), and
 * the JSON is parsed in-process.
 */
export async function glabJson<T = unknown>(
  args: string[],
  ctx?: ProjectContext,
): Promise<T> {
  const result = await run(buildArgs(args, ctx));
  if (result.stderr === "ENOENT") throw missingGlabError();
  if (result.exitCode !== 0)
    throw mapGlabError(result.stderr, result.exitCode, invocation(args));
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new AxiError(
      `Unexpected glab output: ${result.stdout.slice(0, 200)}`,
      "UNKNOWN",
    );
  }
}

/**
 * Execute glab and return raw stdout. `stdin` is piped to the child for the
 * glab forms that read a request body from standard input.
 */
export async function glabExec(
  args: string[],
  ctx?: ProjectContext,
  stdin?: string,
): Promise<string> {
  const result = await run(buildArgs(args, ctx), stdin);
  if (result.stderr === "ENOENT") throw missingGlabError();
  if (result.exitCode !== 0)
    throw mapGlabError(result.stderr, result.exitCode, invocation(args));
  return result.stdout;
}
