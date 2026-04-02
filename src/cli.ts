import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAxiCli } from "axi-sdk-js";
import { resolveRepo, type RepoContext } from "./context.js";
import { homeCommand } from "./commands/home.js";
import { issueCommand, ISSUE_HELP } from "./commands/issue.js";
import { prCommand, PR_HELP } from "./commands/pr.js";
import { runCommand, RUN_HELP } from "./commands/run.js";
import { workflowCommand, WORKFLOW_HELP } from "./commands/workflow.js";
import { releaseCommand, RELEASE_HELP } from "./commands/release.js";
import { repoCommand, REPO_HELP } from "./commands/repo.js";
import { labelCommand, LABEL_HELP } from "./commands/label.js";
import { searchCommand, SEARCH_HELP } from "./commands/search.js";
import { apiCommand, API_HELP } from "./commands/api.js";

const DESCRIPTION =
  "Agent ergonomic wrapper around Github CLI. Prefer this over `gh` and other methods for Github operations.";
const VERSION = readPackageVersion();

type CliStdout = Pick<NodeJS.WriteStream, "write">;

type MainOptions = {
  argv?: string[];
  stdout?: CliStdout;
};

export const TOP_HELP = `usage: gh-axi [command] [args] [flags]
commands[10]:
  (none)=dashboard, issue, pr, run, workflow, release, repo, label, search, api
flags[3]:
  -R/--repo <OWNER/NAME> (after command), --help, -v/-V/--version
examples:
  gh-axi
  gh-axi issue list --state open
  gh-axi issue list -R owner/name
  gh-axi issue list --repo owner/name
  gh-axi pr view 42
`;

const COMMAND_HELP: Record<string, string> = {
  issue: ISSUE_HELP,
  pr: PR_HELP,
  run: RUN_HELP,
  workflow: WORKFLOW_HELP,
  release: RELEASE_HELP,
  repo: REPO_HELP,
  label: LABEL_HELP,
  search: SEARCH_HELP,
  api: API_HELP,
};

type CommandFn = (args: string[], ctx?: RepoContext) => Promise<string>;

const COMMANDS: Record<string, CommandFn> = {
  issue: withRepoContext("issue", issueCommand),
  pr: withRepoContext("pr", prCommand),
  run: withRepoContext("run", runCommand),
  workflow: withRepoContext("workflow", workflowCommand),
  release: withRepoContext("release", releaseCommand),
  repo: withRepoContext("repo", repoCommand),
  label: withRepoContext("label", labelCommand),
  search: withRepoContext("search", searchCommand),
  api: withRepoContext("api", apiCommand),
};

export async function main(options: MainOptions = {}): Promise<void> {
  await runAxiCli<RepoContext | undefined>({
    ...(options.argv ? { argv: options.argv } : {}),
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: TOP_HELP,
    ...(process.env.GH_AXI_DISABLE_HOOKS === "1" ? { hooks: false } : {}),
    ...(options.stdout ? { stdout: options.stdout } : {}),
    home: withRepoContext(undefined, homeCommand),
    commands: COMMANDS,
    getCommandHelp: (command) => COMMAND_HELP[command],
    resolveContext: ({ command, args }) =>
      resolveRepo(parseRepoContextArgs(command, args).repoFlag),
  });
}

function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));

  for (const candidate of [
    join(here, "..", "package.json"),
    join(here, "..", "..", "package.json"),
  ]) {
    if (!existsSync(candidate)) {
      continue;
    }

    const parsed = JSON.parse(readFileSync(candidate, "utf-8")) as {
      version?: unknown;
    };
    if (typeof parsed.version === "string" && parsed.version.length > 0) {
      return parsed.version;
    }
  }

  throw new Error("Could not determine gh-axi package version");
}

function withRepoContext(
  command: string | undefined,
  handler: CommandFn,
): CommandFn {
  return (args, ctx) =>
    handler(parseRepoContextArgs(command, args).strippedArgs, ctx);
}

function parseRepoContextArgs(
  command: string | undefined,
  args: string[],
): { repoFlag: string | undefined; strippedArgs: string[] } {
  const stripped: string[] = [];
  let repoFlag: string | undefined;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "-R" && index + 1 < args.length) {
      repoFlag = args[index + 1];
      index++;
      continue;
    }

    if (arg === "--repo" && index + 1 < args.length) {
      const value = args[index + 1];

      repoFlag = value;

      if (command === "search") {
        stripped.push(arg, value);
      }

      index++;
      continue;
    }

    stripped.push(arg);
  }

  return { repoFlag, strippedArgs: stripped };
}
