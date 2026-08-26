import { execFile } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { AxiError } from "./errors.js";
import { isStdinTTY } from "./stdin.js";
const ALWAYS_FIX_KEY = "gh-axi.ignoreConflicts";
export type GitResult = { stdout: string; stderr: string; exitCode: number };
export type GitRunner = (args: string[], input?: string) => Promise<GitResult>;
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
const defaultRunner: GitRunner = (args, input) =>
  new Promise((resolve) => {
    const child = execFile(
      "git",
      args,
      { maxBuffer: 10 * 1024 * 1024 },
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
): Promise<GitResult> {
  const result = await runner(args, input);
  if (result.exitCode !== 0)
    throw new AxiError(result.stderr || "git command failed", "UNKNOWN");
  return result;
}
export async function detectGitignoreConflicts(
  runner: GitRunner = defaultRunner,
): Promise<HygieneReport> {
  let tracked: string[];
  try {
    tracked = nul(
      (
        await successful(runner, [
          "ls-files",
          "-ci",
          "--exclude-per-directory=.gitignore",
          "-z",
        ])
      ).stdout,
    );
  } catch {
    return { findings: [], gitAvailable: false };
  }
  if (!tracked.length) return { findings: [], gitAvailable: true };
  const trackedSet = new Set(tracked);
  const [stagedResult, workingResult, modesResult, sparseResult] =
    await Promise.all([
      runner(["diff", "--name-only", "--cached", "-z"]),
      runner(["diff", "--name-only", "-z"]),
      runner(["ls-files", "--stage", "-z"]),
      runner(["ls-files", "-t", "-z"]),
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
): Promise<void> {
  const paths = findings.filter((f) => f.eligible).map((f) => f.path);
  if (!paths.length) return;
  await successful(
    runner,
    [
      "rm",
      "--cached",
      "--pathspec-from-file=-",
      "--pathspec-file-nul",
      "--ignore-unmatch",
    ],
    `${paths.join("\0")}\0`,
  );
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
async function configuredAlways(runner: GitRunner): Promise<boolean> {
  const result = await runner(["config", "--local", "--get", ALWAYS_FIX_KEY]);
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
            .map((f) => `${f.path} — ${f.source}:${f.line} (${f.rule})`)
            .join("\n") +
            "\nLocal files are preserved. Fix all? [y]es/[n]o/[a] Always fix: ",
        );
  if (decision === "no") return { ...report, action: "declined" };
  if (decision === "always")
    await successful(runner, ["config", "--local", ALWAYS_FIX_KEY, "true"]);
  await repairGitignoreConflicts(report.findings, runner);
  return { ...report, action: "fixed" };
}
