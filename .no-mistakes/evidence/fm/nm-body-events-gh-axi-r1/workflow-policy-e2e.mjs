import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseDocument } from "yaml";

const workflowPath = ".github/workflows/no-mistakes-required.yml";
const baseCommit = "6e1dcf4dda91c18111f18475e071a8b8a0dd2977";
const marker =
  "Updates from [git push no-mistakes](https://github.com/kunchenguid/no-mistakes)";

function parseWorkflow(source, label) {
  const document = parseDocument(source);
  assert.deepEqual(
    document.errors,
    [],
    `${label} must be syntactically valid YAML`,
  );
  return document.toJS();
}

const currentSource = readFileSync(workflowPath, "utf8");
const baseSource = execFileSync(
  "git",
  ["show", `${baseCommit}:${workflowPath}`],
  { encoding: "utf8" },
);
const diff = execFileSync(
  "git",
  ["diff", baseCommit, "--", workflowPath],
  { encoding: "utf8" },
);
const current = parseWorkflow(currentSource, "target workflow");
const base = parseWorkflow(baseSource, "base workflow");

assert.equal(
  (diff.match(/^@@/gm) ?? []).length,
  2,
  "the policy change must contain exactly two diff hunks",
);
assert.equal(current.name, base.name, "workflow name must remain stable");
assert.deepEqual(current.on, base.on, "pull_request trigger isolation must remain unchanged");
assert.deepEqual(
  current.permissions,
  { contents: "read" },
  "permissions must remain read-only",
);
assert.deepEqual(current.jobs, base.jobs, "all job behavior must remain unchanged");
assert.equal(
  current.jobs.check.name,
  "PR must be raised via no-mistakes",
  "required check name must remain stable",
);
assert.match(
  current.jobs.check.steps[0].run,
  new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  "signature marker must remain stable",
);
assert.doesNotMatch(currentSource, /pull_request_target/, "fork code must not gain secrets");
assert.doesNotMatch(currentSource, /actions\/checkout/, "fork code must not be checked out");
assert.doesNotMatch(currentSource, /\bsecrets\./, "workflow must not access secrets");

assert.equal(
  current["run-name"],
  "PR #${{ github.event.pull_request.number }} body compliance - ${{ github.event.action }} - event ${{ github.run_number }} (run ${{ github.run_id }})",
);
assert.equal(current.concurrency["cancel-in-progress"], true);

function groupFor({ pr, action, runId }) {
  const suffix = action === "opened" || action === "edited" ? runId : "head-change";
  return `no-mistakes-required-${pr}-${suffix}`;
}

const events = [
  { pr: 81, action: "opened", runNumber: 410, runId: 9001 },
  { pr: 81, action: "edited", runNumber: 411, runId: 9002 },
  { pr: 81, action: "edited", runNumber: 412, runId: 9003 },
  { pr: 81, action: "synchronize", runNumber: 413, runId: 9004 },
  { pr: 81, action: "reopened", runNumber: 414, runId: 9005 },
];
const groups = events.map(groupFor);
assert.equal(new Set(groups.slice(0, 3)).size, 3, "body events must never coalesce");
assert.equal(groups[3], groups[4], "head-change events must remain coalesced");

const shell = current.jobs.check.steps[0].run;
function complianceRun(body) {
  const result = spawnSync(
    "/bin/bash",
    ["--noprofile", "--norc", "-eu", "-c", shell],
    {
    encoding: "utf8",
    env: {
      ...process.env,
      PR_BODY: body,
      PR_AUTHOR: "end-user",
      PR_NUMBER: "81",
    },
    },
  );
  return {
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

const signedFirst = complianceRun(`Change summary\n\n${marker}\n`);
const unsigned = complianceRun("Change summary without pipeline signature");
const signedReplay = complianceRun(`Change summary\n\n${marker}\n`);
assert.equal(signedFirst.status, 0);
assert.equal(unsigned.status, 1);
assert.equal(signedReplay.status, 0);
assert.deepEqual(signedReplay, signedFirst, "signed replay must be deterministic");

console.log("Workflow syntax: valid YAML");
console.log("Change shape: exactly two hunks");
console.log("Preservation: pull_request trigger, read-only permissions, stable job/check, bot exemptions, signature marker, and no checkout/secrets are unchanged");
console.log("Event routing:");
for (const [index, event] of events.entries()) {
  const runName = `PR #${event.pr} body compliance - ${event.action} - event ${event.runNumber} (run ${event.runId})`;
  console.log(`  ${event.action.padEnd(11)} run-name="${runName}"`);
  console.log(`  ${"".padEnd(11)} group="${groups[index]}" cancel-in-progress=true`);
}
console.log("Compliance replay:");
console.log(`  signed   exit=${signedFirst.status} output="${signedFirst.stdout}"`);
console.log(`  unsigned exit=${unsigned.status} error="${unsigned.stderr.split("\n")[0]}"`);
console.log(`  signed   exit=${signedReplay.status} output="${signedReplay.stdout}"`);
console.log("RESULT: all workflow policy acceptance checks passed");
