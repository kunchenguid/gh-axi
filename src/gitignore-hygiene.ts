import { execFile } from "node:child_process";
import {
  FileHandle,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { AxiError } from "./errors.js";
import { isStdinTTY } from "./stdin.js";
const ALWAYS_FIX_KEY = "gh-axi.ignoreConflicts";
export type GitResult = { stdout: string; stderr: string; exitCode: number };
export type GitRunner = (
  args: string[],
  input?: string,
  env?: NodeJS.ProcessEnv,
) => Promise<GitResult>;
export type HygieneFinding = {
  path: string;
  rule: string;
  line: number;
  source: string;
  workingTree: "clean" | "modified" | "unavailable";
  index: "clean" | "staged-different" | "unavailable";
  classification: "policy-drift" | "manual";
  eligible: boolean;
  reason?: string;
};
export type HygieneReport = {
  findings: HygieneFinding[];
  gitAvailable: boolean;
};
export type PreflightPolicy = "report" | "interactive" | "explicit-fix";
export type PreflightResult = HygieneReport & {
  action: "none" | "reported" | "declined" | "fixed" | "manual";
};
const defaultRunner: GitRunner = (args, input, env) =>
  new Promise((resolve) => {
    const child = execFile(
      "git",
      args,
      { env: { ...process.env, ...env }, maxBuffer: 10 * 1024 * 1024 },
      (error, stdoutText, stderrText) => {
        const code = error as (Error & { code?: number }) | null;
        resolve({
          stdout: stdoutText ?? "",
          stderr: stderrText ?? "",
          exitCode: code ? Number(code.code) || 1 : 0,
        });
      },
    );
    if (input !== undefined) child.stdin?.end(input);
  });
function nul(value: string): string[] {
  return value.split("\0").filter(Boolean);
}
async function successful(
  runner: GitRunner,
  args: string[],
  input?: string,
  env?: NodeJS.ProcessEnv,
): Promise<GitResult> {
  const result = await runner(args, input, env);
  if (result.exitCode !== 0)
    throw new AxiError(result.stderr || "git command failed", "UNKNOWN");
  return result;
}
export async function detectGitignoreConflicts(
  runner: GitRunner = defaultRunner,
  env?: NodeJS.ProcessEnv,
): Promise<HygieneReport> {
  let tracked: string[];
  try {
    tracked = nul(
      (
        await successful(
          runner,
          ["ls-files", "-ci", "--exclude-per-directory=.gitignore", "-z"],
          undefined,
          env,
        )
      ).stdout,
    );
  } catch {
    return { findings: [], gitAvailable: false };
  }
  if (!tracked.length) return { findings: [], gitAvailable: true };
  const trackedSet = new Set(tracked);
  const [stagedResult, workingResult, modesResult, sparseResult] =
    await Promise.all([
      runner(["diff", "--name-only", "--cached", "-z"], undefined, env),
      runner(["diff", "--name-only", "-z"], undefined, env),
      runner(["ls-files", "--stage", "-z"], undefined, env),
      runner(["ls-files", "-t", "-z"], undefined, env),
    ]);
  const probeFailed = [
    stagedResult,
    workingResult,
    modesResult,
    sparseResult,
  ].some((r) => r.exitCode !== 0);
  const staged = new Set(nul(stagedResult.stdout));
  const working = new Set(nul(workingResult.stdout));
  const modes = new Map(
    nul(modesResult.stdout).map((line) => {
      const tab = line.indexOf("\t");
      return [line.slice(tab + 1), line.slice(0, tab).split(" ")[0]] as const;
    }),
  );
  const sparse = new Set(
    nul(sparseResult.stdout)
      .filter((line) => line.startsWith("S "))
      .map((line) => line.slice(2)),
  );
  const evidence = await runner(
    ["check-ignore", "-v", "--no-index", "--stdin", "-z"],
    `${tracked.join("\0")}\0`,
    env,
  );
  if (evidence.exitCode !== 0 && evidence.exitCode !== 1)
    return { findings: [], gitAvailable: false };
  const fields = nul(evidence.stdout);
  const findings: HygieneFinding[] = [];
  for (let i = 0; i + 3 < fields.length; i += 4) {
    const [source, line, rule, path] = fields.slice(i, i + 4);
    const lineNumber = Number(line);
    if (
      !Number.isInteger(lineNumber) ||
      !/^(.+\/)?\.gitignore$/.test(source) ||
      !trackedSet.has(path)
    )
      continue;
    const reason = probeFailed
      ? "Git safety probe unavailable"
      : modes.get(path) === "160000"
        ? "submodule gitlink"
        : sparse.has(path)
          ? "sparse-checkout path"
          : staged.has(path)
            ? "index differs from HEAD (staged content)"
            : undefined;
    findings.push({
      path,
      rule,
      line: lineNumber,
      source,
      workingTree: probeFailed
        ? "unavailable"
        : working.has(path)
          ? "modified"
          : "clean",
      index: probeFailed
        ? "unavailable"
        : staged.has(path)
          ? "staged-different"
          : "clean",
      classification: reason ? "manual" : "policy-drift",
      eligible: !reason,
      ...(reason ? { reason } : {}),
    });
  }
  return { findings, gitAvailable: true };
}
export async function repairGitignoreConflicts(
  findings: HygieneFinding[],
  runner: GitRunner = defaultRunner,
): Promise<number> {
  const consented = new Set(
    findings.filter((f) => f.eligible).map((f) => f.path),
  );
  let lock: FileHandle | undefined;
  let ownsLock = false;
  let lockPath = "";
  let tempPath = "";
  let committed = false;
  try {
    const result = await successful(runner, [
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "index",
    ]);
    const indexPath = result.stdout.trim();
    lockPath = `${indexPath}.lock`;
    const mode = (await stat(indexPath)).mode;
    // Git's canonical index.lock is acquired before revalidation and held
    // through atomic rename; competing writers fail and existing locks are
    // never removed.
    lock = await open(lockPath, "wx", mode);
    ownsLock = true;
    tempPath = `${indexPath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tempPath, await readFile(indexPath), {
      mode: mode & 0o777,
    });
    const latest = await detectGitignoreConflicts(runner, {
      GIT_OPTIONAL_LOCKS: "0",
    });
    const paths = latest.findings
      .filter((f) => f.eligible && consented.has(f.path))
      .map((f) => f.path);
    if (!paths.length) return 0;
    const removed = await runner(
      [
        "rm",
        "--cached",
        "--pathspec-from-file=-",
        "--pathspec-file-nul",
        "--ignore-unmatch",
      ],
      `${paths.join("\0")}\0`,
      { GIT_INDEX_FILE: tempPath },
    );
    if (removed.exitCode !== 0)
      throw new AxiError(removed.stderr || "git command failed", "UNKNOWN");
    await lock.writeFile(await readFile(tempPath));
    await lock.sync();
    await lock.close();
    lock = undefined;
    await rename(lockPath, indexPath);
    committed = true;
    return paths.length;
  } catch {
    return 0;
  } finally {
    await lock?.close().catch(() => undefined);
    if (tempPath) await unlink(tempPath).catch(() => undefined);
    if (tempPath) await unlink(`${tempPath}.lock`).catch(() => undefined);
    if (ownsLock && !committed && lockPath)
      await unlink(lockPath).catch(() => undefined);
  }
}
export type Prompt = (message: string) => Promise<"yes" | "no" | "always">;
export const terminalPrompt: Prompt = async (message) => {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(message)).trim().toLowerCase();
    return answer === "a" || answer === "always"
      ? "always"
      : answer === "y" || answer === "yes"
        ? "yes"
        : "no";
  } finally {
    rl.close();
  }
};

export function escapeTerminalControl(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}]/gu, (character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint <= 0xff
      ? `\\x${codePoint.toString(16).padStart(2, "0").toUpperCase()}`
      : `\\u{${codePoint.toString(16).toUpperCase()}}`;
  });
}

export function displayHygieneFinding(finding: HygieneFinding): HygieneFinding {
  return {
    ...finding,
    path: escapeTerminalControl(finding.path),
    source: escapeTerminalControl(finding.source ?? ""),
    rule: escapeTerminalControl(finding.rule ?? ""),
  };
}
function promptFinding(finding: HygieneFinding): string {
  return `${escapeTerminalControl(finding.path)} - ${escapeTerminalControl(finding.source)}:${finding.line} (${escapeTerminalControl(finding.rule)})`;
}

async function configuredAlways(runner: GitRunner): Promise<boolean> {
  const result = await runner([
    "config",
    "--local",
    "--type=bool",
    "--get",
    ALWAYS_FIX_KEY,
  ]);
  return result.exitCode === 0 && result.stdout.trim() === "true";
}
export async function runGitignorePreflight(
  options: {
    policy?: PreflightPolicy;
    runner?: GitRunner;
    prompt?: Prompt;
    interactive?: boolean;
  } = {},
): Promise<PreflightResult> {
  const runner = options.runner ?? defaultRunner;
  const report = await detectGitignoreConflicts(runner);
  if (!report.gitAvailable || !report.findings.length)
    return { ...report, action: "none" };
  if (!report.findings.some((f) => f.eligible))
    return { ...report, action: "manual" };
  const explicit = options.policy === "explicit-fix";
  const tty =
    options.interactive ?? (isStdinTTY() && options.policy === "interactive");
  const configured = tty && !explicit && (await configuredAlways(runner));
  if (!explicit && !tty && !configured)
    return { ...report, action: "reported" };
  const decision =
    explicit || configured
      ? "yes"
      : await (options.prompt ?? terminalPrompt)(
          report.findings
            .filter((f) => f.eligible)
            .map(promptFinding)
            .join("\n") +
            "\nLocal files are preserved. Fix all? [y]es/[n]o/[a] Always fix: ",
        );
  if (decision === "no") return { ...report, action: "declined" };
  if (decision === "always")
    await successful(runner, ["config", "--local", ALWAYS_FIX_KEY, "true"]);
  const repaired = await repairGitignoreConflicts(report.findings, runner);
  const remaining = await detectGitignoreConflicts(runner);
  return {
    ...remaining,
    action: !remaining.gitAvailable
      ? "manual"
      : remaining.findings.length === 0
        ? "fixed"
        : repaired > 0 || remaining.findings.length > 0
          ? "manual"
          : "none",
  };
}
