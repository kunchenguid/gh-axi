#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = process.cwd();
const evidenceDir = resolve(
  root,
  ".no-mistakes/evidence/fm/gh-axi-bodyfile-b8",
);
const stubDir = join(evidenceDir, "bin");
const bodyPath = join(evidenceDir, "body.md");
const notesPath = join(evidenceDir, "release-notes.md");
const logPath = join(evidenceDir, "gh-stub-command-log.md");
const transcriptPath = join(evidenceDir, "cli-body-file-transcript.md");
const stubPath = join(stubDir, "gh");

mkdirSync(stubDir, { recursive: true });

const body = [
  "# Body file E2E",
  "",
  "- dash-leading markdown survives",
  "- second bullet stays on its own line",
  "",
  "```ts",
  "const fromBodyFile = true;",
  "```",
  "",
  "Final paragraph with `inline code`.",
].join("\n");

const notes = [
  "# Release notes E2E",
  "",
  "## Highlights",
  "",
  "- Notes came from --body-file",
  "- Existing release assets remain positional arguments",
].join("\n");

writeFileSync(bodyPath, body, "utf8");
writeFileSync(notesPath, notes, "utf8");

writeFileSync(
  stubPath,
  `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
const logPath = process.env.GH_AXI_E2E_LOG;

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function appendLog() {
  if (!logPath) return;
  const body = valueAfter("--body");
  const notes = valueAfter("--notes");
  const notesFile = valueAfter("--notes-file");
  const repo = valueAfter("--repo");
  let block = "\\n## gh " + JSON.stringify(args) + "\\n\\n";
  if (repo) block += "repo: " + repo + "\\n\\n";
  if (body !== undefined) block += "body:\\n~~~markdown\\n" + body + "\\n~~~\\n\\n";
  if (notes !== undefined) block += "notes:\\n~~~markdown\\n" + notes + "\\n~~~\\n\\n";
  if (notesFile !== undefined) block += "notes_file: " + notesFile + "\\n\\n";
  appendFileSync(logPath, block, "utf8");
}

function json(data) {
  process.stdout.write(JSON.stringify(data));
}

appendLog();

if (args[0] === "pr" && args[1] === "create") {
  process.stdout.write("https://github.com/octo/repo/pull/123\\n");
  process.exit(0);
}

if (args[0] === "pr" && args[1] === "view") {
  json({ state: "OPEN", mergedBy: null, mergedAt: null, statusCheckRollup: [] });
  process.exit(0);
}

if (args[0] === "issue" && args[1] === "create") {
  process.stdout.write("https://github.com/octo/repo/issues/99\\n");
  process.exit(0);
}

if (args[0] === "issue" && args[1] === "view") {
  const fields = valueAfter("--json") || "";
  if (fields === "comments") {
    json({
      comments: [
        {
          author: { login: "octocat" },
          body: "latest comment returned after --body-file post",
          createdAt: "2026-06-21T21:31:00Z"
        }
      ]
    });
    process.exit(0);
  }
  if (fields.includes("labels")) {
    json({ number: 99, title: "E2E body-file issue", state: "OPEN", labels: [], assignees: [], id: "I_kwE2E" });
    process.exit(0);
  }
  json({ number: 99, title: "E2E body-file issue", state: "OPEN", url: "https://github.com/octo/repo/issues/99", id: "I_kwE2E" });
  process.exit(0);
}

process.stdout.write("");
process.exit(0);
`,
  "utf8",
);
chmodSync(stubPath, 0o755);
writeFileSync(logPath, "# gh stub command log\n", "utf8");

const env = {
  ...process.env,
  PATH: `${stubDir}:${process.env.PATH}`,
  GH_AXI_E2E_LOG: logPath,
  NO_COLOR: "1",
};

const commands = [
  { argv: ["issue", "--help"], expectedExit: 0 },
  { argv: ["pr", "--help"], expectedExit: 0 },
  { argv: ["release", "--help"], expectedExit: 0 },
  {
    argv: [
      "pr",
      "create",
      "--title",
      "E2E body-file PR",
      "--body-file",
      bodyPath,
    ],
    expectedExit: 0,
  },
  { argv: ["pr", "edit", "123", "--body-file", bodyPath], expectedExit: 0 },
  {
    argv: ["pr", "review", "123", "--comment", "--body-file", bodyPath],
    expectedExit: 0,
  },
  { argv: ["pr", "comment", "123", "--body-file", bodyPath], expectedExit: 0 },
  {
    argv: [
      "pr",
      "merge",
      "123",
      "--squash",
      "--delete-branch",
      "--subject",
      "Squash subject",
      "--body-file",
      bodyPath,
    ],
    expectedExit: 0,
  },
  {
    argv: [
      "issue",
      "create",
      "--title",
      "E2E body-file issue",
      "--body-file",
      bodyPath,
    ],
    expectedExit: 0,
  },
  { argv: ["issue", "edit", "99", "--body-file", bodyPath], expectedExit: 0 },
  {
    argv: ["issue", "comment", "99", "--body-file", bodyPath],
    expectedExit: 0,
  },
  {
    argv: [
      "release",
      "create",
      "v9.9.9-bodyfile",
      "--body-file",
      notesPath,
      "--draft",
      "dist/app.zip",
    ],
    expectedExit: 0,
  },
  {
    argv: [
      "release",
      "edit",
      "v9.9.9-bodyfile",
      "--body-file",
      notesPath,
      "--title",
      "Retitled release",
    ],
    expectedExit: 0,
  },
  {
    argv: [
      "pr",
      "comment",
      "123",
      "--body",
      "inline body",
      "--body-file",
      bodyPath,
    ],
    expectedExit: 2,
  },
  {
    argv: [
      "issue",
      "comment",
      "99",
      "--body-file",
      join(evidenceDir, "missing.md"),
    ],
    expectedExit: 2,
  },
  {
    argv: [
      "release",
      "edit",
      "v9.9.9-bodyfile",
      "--body-file",
      notesPath,
      "--notes-file",
      "other-notes.md",
    ],
    expectedExit: 2,
  },
  {
    argv: [
      "pr",
      "comment",
      "123",
      "--body",
      "- dash-leading inline body\n- still inline",
    ],
    expectedExit: 0,
  },
];

let transcript = "# gh-axi --body-file E2E transcript\n\n";
transcript += `body_file: ${bodyPath}\n`;
transcript += `release_notes_file: ${notesPath}\n\n`;
const failures = [];

for (const { argv, expectedExit } of commands) {
  const result = spawnSync("pnpm", ["exec", "tsx", "bin/gh-axi.ts", ...argv], {
    cwd: root,
    env,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const actualExit = result.status ?? 1;
  if (actualExit !== expectedExit) {
    failures.push(
      `Expected exit ${expectedExit} but got ${actualExit}: gh-axi ${argv.join(" ")}`,
    );
  }
  transcript += `## gh-axi ${argv.map((arg) => JSON.stringify(arg)).join(" ")}\n\n`;
  transcript += `expected_exit_code: ${expectedExit}\n`;
  transcript += `exit_code: ${actualExit}\n\n`;
  if (result.stdout) {
    transcript += "stdout:\n```toon\n" + result.stdout + "\n```\n\n";
  }
  if (result.stderr) {
    transcript += "stderr:\n```text\n" + result.stderr + "\n```\n\n";
  }
}

if (failures.length > 0) {
  transcript += "## Harness failures\n\n";
  transcript += failures.map((failure) => `- ${failure}`).join("\n") + "\n";
}

writeFileSync(transcriptPath, transcript, "utf8");
console.log(transcriptPath);

if (failures.length > 0) {
  process.exit(1);
}
