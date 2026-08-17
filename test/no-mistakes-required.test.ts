import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = fileURLToPath(new URL("..", import.meta.url));
const marker =
  "Updates from [git push no-mistakes](https://github.com/kunchenguid/no-mistakes)";

type WorkflowStep = {
  name?: unknown;
  env?: unknown;
  run?: unknown;
};

type NoMistakesWorkflow = {
  permissions?: unknown;
  jobs?: {
    check?: {
      steps?: unknown;
    };
  };
};

function signatureCheck(): {
  permissions: Record<string, unknown>;
  env: Record<string, string>;
  run: string;
} {
  const workflow = parse(
    readFileSync(
      join(root, ".github", "workflows", "no-mistakes-required.yml"),
      "utf8",
    ),
  ) as NoMistakesWorkflow;
  if (
    typeof workflow.permissions !== "object" ||
    workflow.permissions === null ||
    Array.isArray(workflow.permissions)
  ) {
    throw new Error("no-mistakes workflow has no permissions");
  }

  const step = workflow.jobs?.check?.steps;
  if (!Array.isArray(step)) {
    throw new Error("no-mistakes workflow check has no steps");
  }

  const signatureStep = step.find(
    (candidate): candidate is WorkflowStep =>
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as WorkflowStep).name ===
        "Verify no-mistakes signature in PR body",
  );
  if (!signatureStep || typeof signatureStep.run !== "string") {
    throw new Error("no-mistakes signature check has no executable script");
  }
  if (
    typeof signatureStep.env !== "object" ||
    signatureStep.env === null ||
    Array.isArray(signatureStep.env)
  ) {
    throw new Error("no-mistakes signature check has no environment");
  }

  const env = Object.fromEntries(
    Object.entries(signatureStep.env).map(([key, value]) => [
      key,
      String(value),
    ]),
  );
  return {
    permissions: workflow.permissions as Record<string, unknown>,
    env,
    run: signatureStep.run,
  };
}

function runSignatureCheck(currentPrBody: string, eventPrBody: string) {
  const { run } = signatureCheck();
  const directory = mkdtempSync(join(tmpdir(), "gh-axi-no-mistakes-"));
  try {
    const gh = join(directory, "gh");
    writeFileSync(
      gh,
      `#!/bin/sh
set -eu
[ "$#" -eq 4 ]
[ "$1" = "api" ]
[ "$2" = "repos/\${PR_REPOSITORY}/pulls/\${PR_NUMBER}" ]
[ "$3" = "--jq" ]
[ "$4" = ".body" ]
printf '%s' "$CURRENT_PR_BODY"
`,
      "utf8",
    );
    chmodSync(gh, 0o755);

    return spawnSync("bash", ["-c", run], {
      encoding: "utf8",
      env: {
        ...process.env,
        CURRENT_PR_BODY: currentPrBody,
        GH_TOKEN: "test-token",
        PATH: `${directory}${delimiter}${process.env.PATH ?? ""}`,
        PR_AUTHOR: "octocat",
        PR_BODY: eventPrBody,
        PR_NUMBER: "108",
        PR_REPOSITORY: "octo/widgets",
      },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("no-mistakes PR body workflow", () => {
  it("checks the current PR body when the event body is stale", () => {
    const { permissions, env } = signatureCheck();

    expect(permissions).toMatchObject({
      contents: "read",
      "pull-requests": "read",
    });
    expect(env).toMatchObject({
      GH_TOKEN: "${{ github.token }}",
      PR_NUMBER: "${{ github.event.pull_request.number }}",
      PR_REPOSITORY: "${{ github.repository }}",
    });
    const result = runSignatureCheck(
      `## Pipeline\n\n${marker}`,
      "PR body before no-mistakes wrote its signature",
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "Found no-mistakes signature in PR #108 body.",
    );
  });

  it("rejects a current PR body without the signature", () => {
    const result = runSignatureCheck(
      "An unsigned PR body",
      `## Pipeline\n\n${marker}`,
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "This PR was not raised through no-mistakes.",
    );
  });
});
