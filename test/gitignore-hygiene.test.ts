import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { describe, expect, it, vi } from "vitest";
import {
  detectGitignoreConflicts,
  repairGitignoreConflicts,
  runGitignorePreflight,
  type GitResult,
  type GitRunner,
} from "../src/gitignore-hygiene.js";

const repos: string[] = [];

async function git(
  repo: string,
  args: string[],
  input?: string,
  env?: NodeJS.ProcessEnv,
): Promise<GitResult> {
  return new Promise((resolve) => {
    const child = execFile(
      "git",
      args,
      {
        cwd: repo,
        env: { ...process.env, ...env },
        maxBuffer: 20 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const result = error as { code?: number } | null;
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: result ? Number(result.code) || 1 : 0,
        });
      },
    );
    if (input !== undefined) child.stdin?.end(input);
  });
}

async function repo(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "gh-axi-hygiene-"));
  repos.push(path);
  expect((await git(path, ["init", "-q"])).exitCode).toBe(0);
  expect(
    (await git(path, ["config", "user.email", "test@example.com"])).exitCode,
  ).toBe(0);
  expect((await git(path, ["config", "user.name", "Test"])).exitCode).toBe(0);
  return path;
}

async function commit(
  repoPath: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(repoPath, path, ".."), { recursive: true });
    await writeFile(join(repoPath, path), content);
  }
  if (".gitignore" in files)
    expect((await git(repoPath, ["add", ".gitignore"])).exitCode).toBe(0);
  const trackedPaths = Object.keys(files).filter(
    (path) => path !== ".gitignore",
  );
  if (trackedPaths.length > 0)
    expect(
      (await git(repoPath, ["add", "-f", "--", ...trackedPaths])).exitCode,
    ).toBe(0);
  expect((await git(repoPath, ["commit", "-qm", "initial"])).exitCode).toBe(0);
}

async function detected(repoPath: string) {
  return detectGitignoreConflicts((args, input, env) =>
    git(repoPath, args, input, env),
  );
}

afterEach(async () => {
  await Promise.all(
    repos.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
  vi.restoreAllMocks();
});
describe("gitignore hygiene", () => {
  it("reports a modified tracked ignored file while preserving worktree and index", async () => {
    const r = await repo();
    await commit(r, { ".gitignore": "ignored.txt\n", "ignored.txt": "one" });
    await writeFile(join(r, "ignored.txt"), "two");
    const report = await detected(r);
    expect(report.findings).toEqual([
      expect.objectContaining({
        path: "ignored.txt",
        workingTree: "modified",
        index: "clean",
        eligible: true,
      }),
    ]);
  });

  it("explicitly fixes by removing only the index entry and preserves exact bytes", async () => {
    const r = await repo();
    const bytes = "zero\0one\n two";
    await commit(r, { ".gitignore": "ignored\n", ignored: bytes });
    const result = await runGitignorePreflight({
      policy: "explicit-fix",
      runner: (a, i, e) => git(r, a, i, e),
    });
    expect(result.action).toBe("fixed");
    expect(await readFile(join(r, "ignored"), "utf8")).toBe(bytes);
    expect(
      (await git(r, ["ls-files", "--error-unmatch", "ignored"])).exitCode,
    ).not.toBe(0);
  });

  it("handles nested rules and spaces", async () => {
    const r = await repo();
    await commit(r, {
      ".gitignore": "other\n",
      "nested/.gitignore": "file with spaces\n",
      "nested/file with spaces": "x",
    });
    const report = await detected(r);
    expect(report.findings.map((f) => f.path)).toContain(
      "nested/file with spaces",
    );
  });

  it("handles a pathname containing a newline", async () => {
    const r = await repo();
    const path = "line\nbreak.txt";
    await commit(r, { ".gitignore": "*.txt\n", [path]: "x" });
    expect((await detected(r)).findings.map((f) => f.path)).toContain(path);
  });

  it("does not repair staged-different files", async () => {
    const r = await repo();
    await commit(r, { ".gitignore": "ignored\n", ignored: "one" });
    await writeFile(join(r, "ignored"), "two");
    await git(r, ["add", "ignored"]);
    const report = await detected(r);
    const finding = report.findings.find((f) => f.path === "ignored")!;
    expect(finding).toMatchObject({
      eligible: false,
      classification: "manual",
      reason: expect.stringContaining("staged"),
    });
    await repairGitignoreConflicts([finding], (a, i, e) => git(r, a, i, e));
    expect(
      (await git(r, ["ls-files", "--error-unmatch", "ignored"])).exitCode,
    ).toBe(0);
  });

  it("revalidates findings before repair when a file becomes staged", async () => {
    const r = await repo();
    await commit(r, { ".gitignore": "ignored\n", ignored: "one" });
    const findings = (await detected(r)).findings;
    await writeFile(join(r, "ignored"), "two");
    await git(r, ["add", "ignored"]);

    await repairGitignoreConflicts(findings, (a, i, e) => git(r, a, i, e));

    expect(
      (await git(r, ["ls-files", "--error-unmatch", "ignored"])).exitCode,
    ).toBe(0);
  });

  it("prompts once and declines with evidence", async () => {
    const r = await repo();
    await commit(r, { ".gitignore": "ignored\n", ignored: "x" });
    const prompt = vi.fn(async (message: string) => {
      expect(message).toContain("ignored");
      expect(message).toContain(".gitignore:1");
      expect(message).toContain("ignored");
      expect(message).toContain("Local files are preserved");
      return "no" as const;
    });
    const result = await runGitignorePreflight({
      policy: "interactive",
      interactive: true,
      prompt,
      runner: (a, i, e) => git(r, a, i, e),
    });
    expect(result.action).toBe("declined");
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("escapes terminal control bytes in the interactive consent prompt", async () => {
    const r = await repo();
    const path = "\x1b[2Jerase.txt";
    await commit(r, { ".gitignore": "*.txt\n", [path]: "x" });
    const prompt = vi.fn(async (message: string) => {
      expect(message).toContain("\\x1B[2Jerase.txt");
      expect(message).not.toContain("\x1b");
      return "no" as const;
    });

    await runGitignorePreflight({
      policy: "interactive",
      interactive: true,
      prompt,
      runner: (a, i, e) => git(r, a, i, e),
    });

    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("escapes Unicode format controls in the interactive consent prompt", async () => {
    const r = await repo();
    const path = `safe\u202Etxt`;
    await commit(r, { ".gitignore": `safe\u202E*\n`, [path]: "x" });
    const prompt = vi.fn(async (message: string) => {
      expect(message).toContain("safe\\u{202E}txt");
      expect(message).not.toContain("\u202E");
      return "no" as const;
    });

    await runGitignorePreflight({
      policy: "interactive",
      interactive: true,
      prompt,
      runner: (a, i, e) => git(r, a, i, e),
    });

    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("retains a manual outcome when only eligible conflicts were repaired", async () => {
    const r = await repo();
    await commit(r, { ".gitignore": "a\nb\n", a: "one", b: "one" });
    await writeFile(join(r, "a"), "staged");
    expect((await git(r, ["add", "-f", "--", "a"])).exitCode).toBe(0);

    const result = await runGitignorePreflight({
      policy: "explicit-fix",
      runner: (a, i, e) => git(r, a, i, e),
    });

    expect(result.action).toBe("manual");
    expect((await git(r, ["ls-files", "--error-unmatch", "a"])).exitCode).toBe(
      0,
    );
    expect(
      (await git(r, ["ls-files", "--error-unmatch", "b"])).exitCode,
    ).not.toBe(0);
    expect(result.findings).toEqual([
      expect.objectContaining({
        path: "a",
        eligible: false,
        classification: "manual",
      }),
    ]);
  });

  it("prompts once and fixes on yes", async () => {
    const r = await repo();
    await commit(r, { ".gitignore": "ignored\n", ignored: "x" });
    const prompt = vi.fn(async () => "yes" as const);
    const result = await runGitignorePreflight({
      policy: "interactive",
      interactive: true,
      prompt,
      runner: (a, i, e) => git(r, a, i, e),
    });
    expect(result.action).toBe("fixed");
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("persists Always and fixes future interactive runs automatically", async () => {
    const r = await repo();
    await commit(r, { ".gitignore": "ignored\n", ignored: "x" });
    const prompt = vi.fn(async () => "always" as const);
    await runGitignorePreflight({
      policy: "interactive",
      interactive: true,
      prompt,
      runner: (a, i, e) => git(r, a, i, e),
    });
    await git(r, ["add", ".gitignore"]);
    await writeFile(join(r, "ignored"), "y");
    await git(r, ["add", "-f", "--", "ignored"]);
    await git(r, ["commit", "-qm", "restore ignored"]);
    const second = await runGitignorePreflight({
      policy: "interactive",
      interactive: true,
      prompt,
      runner: (a, i, e) => git(r, a, i, e),
    });
    expect(second.action).toBe("fixed");
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("honors Git's other true values for the local Always preference", async () => {
    const r = await repo();
    await commit(r, { ".gitignore": "ignored\n", ignored: "x" });
    await git(r, ["config", "--local", "gh-axi.ignoreConflicts", "yes"]);
    const prompt = vi.fn(async () => "no" as const);
    const result = await runGitignorePreflight({
      policy: "interactive",
      interactive: true,
      prompt,
      runner: (a, i, e) => git(r, a, i, e),
    });
    expect(result.action).toBe("fixed");
    expect(prompt).not.toHaveBeenCalled();
  });

  it("keeps saved Always disabled for report/noninteractive policy", async () => {
    const r = await repo();
    await commit(r, { ".gitignore": "ignored\n", ignored: "x" });
    await git(r, ["config", "--local", "gh-axi.ignoreConflicts", "true"]);
    const result = await runGitignorePreflight({
      policy: "report",
      runner: (a, i, e) => git(r, a, i, e),
    });
    expect(result.action).toBe("reported");
    expect(
      (await git(r, ["ls-files", "--error-unmatch", "ignored"])).exitCode,
    ).toBe(0);
  });

  it("returns manual and performs no mutation when a safety probe fails", async () => {
    const r = await repo();
    await commit(r, { ".gitignore": "ignored\n", ignored: "x" });
    const baseRunner = (a: string[], i?: string, e?: NodeJS.ProcessEnv) =>
      git(r, a, i, e);
    const runner: GitRunner = async (args, input, env) =>
      args[0] === "diff"
        ? { stdout: "", stderr: "probe failed", exitCode: 1 }
        : baseRunner(args, input, env);
    const result = await runGitignorePreflight({
      policy: "explicit-fix",
      runner,
    });
    expect(result.action).toBe("manual");
    expect(
      (await git(r, ["ls-files", "--error-unmatch", "ignored"])).exitCode,
    ).toBe(0);
  });

  it("keeps all state when the index changes before batch repair", async () => {
    const r = await repo();
    await commit(r, { ".gitignore": "a\nb\n", a: "a", b: "b" });
    const findings = (await detected(r)).findings;
    await writeFile(join(r, "a"), "changed");
    expect((await git(r, ["add", "-f", "--", "a"])).exitCode).toBe(0);
    await writeFile(join(r, ".git", "index.lock"), "locked");
    expect(
      await repairGitignoreConflicts(findings, (a, i, e) => git(r, a, i, e)),
    ).toBe(0);
    expect((await git(r, ["ls-files", "--error-unmatch", "a"])).exitCode).toBe(
      0,
    );
    expect((await git(r, ["ls-files", "--error-unmatch", "b"])).exitCode).toBe(
      0,
    );
    expect(await readFile(join(r, "a"), "utf8")).toBe("changed");
    expect(await readFile(join(r, "b"), "utf8")).toBe("b");
  });

  it("reports clean repositories without attempting mutation", async () => {
    const r = await repo();
    await commit(r, { "tracked.txt": "x" });
    const runner = vi.fn((a: string[], i?: string, e?: NodeJS.ProcessEnv) =>
      git(r, a, i, e),
    );
    const result = await runGitignorePreflight({
      policy: "explicit-fix",
      runner,
    });
    expect(result).toMatchObject({ action: "none", findings: [] });
    expect(runner).not.toHaveBeenCalledWith(
      expect.arrayContaining(["rm"]),
      expect.anything(),
    );
  });
  it("blocks on an external lock without changing its bytes", async () => {
    const r = await repo();
    await commit(r, { ".gitignore": "ignored\n", ignored: "x" });
    const lock = join(r, ".git", "index.lock");
    await writeFile(lock, "external");
    const result = await repairGitignoreConflicts(
      (await detected(r)).findings,
      (a, i, e) => git(r, a, i, e),
    );
    expect(result).toBe(0);
    expect(await readFile(lock, "utf8")).toBe("external");
  });

  it("cleans owned lock and temp files when no paths remain", async () => {
    const r = await repo();
    await commit(r, { ".gitignore": "ignored\n", ignored: "x" });
    const findings = (await detected(r)).findings.map((f) => ({
      ...f,
      eligible: false,
    }));
    expect(
      await repairGitignoreConflicts(findings, (a, i, e) => git(r, a, i, e)),
    ).toBe(0);
    expect(
      (await git(r, ["ls-files", "--error-unmatch", "ignored"])).exitCode,
    ).toBe(0);
    expect(
      (await readdir(join(r, ".git"))).filter(
        (p) => p === "index.lock" || p.startsWith("index.tmp-"),
      ),
    ).toEqual([]);
  });

  it("cleans temporary state after temp-index rm failure", async () => {
    const r = await repo();
    await commit(r, { ".gitignore": "ignored\n", ignored: "x" });
    const findings = (await detected(r)).findings;
    const runner: GitRunner = async (args, input, env) =>
      args[0] === "rm"
        ? { stdout: "", stderr: "injected failure", exitCode: 1 }
        : git(r, args, input, env);
    expect(await repairGitignoreConflicts(findings, runner)).toBe(0);
    expect(
      (await git(r, ["ls-files", "--error-unmatch", "ignored"])).exitCode,
    ).toBe(0);
    expect(await readFile(join(r, "ignored"), "utf8")).toBe("x");
    expect(
      (await readdir(join(r, ".git"))).filter(
        (p) => p === "index.lock" || p.startsWith("index.tmp-"),
      ),
    ).toEqual([]);
  });
  it("blocks competing real git add while atomically repairing", async () => {
    const r = await repo();
    await commit(r, { ".gitignore": "ignored\n", ignored: "before" });
    await writeFile(join(r, "ignored"), "modified bytes");
    const findings = (await detected(r)).findings;
    let competingExit = -1;
    const runner: GitRunner = async (args, input, env) => {
      if (args[0] === "rm" && env?.GIT_INDEX_FILE) {
        competingExit = (await git(r, ["add", "-f", "--", "ignored"])).exitCode;
      }
      return git(r, args, input, env);
    };
    expect(await repairGitignoreConflicts(findings, runner)).toBe(1);
    expect(competingExit).not.toBe(0);
    expect(
      (await git(r, ["ls-files", "--error-unmatch", "ignored"])).exitCode,
    ).not.toBe(0);
    expect(await readFile(join(r, "ignored"), "utf8")).toBe("modified bytes");
  });
});
