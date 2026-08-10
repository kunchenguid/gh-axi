import { encode } from "@toon-format/toon";
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
import { projectCommand, PROJECT_HELP } from "./commands/project.js";
import { secretCommand, SECRET_HELP } from "./commands/secret.js";
import { variableCommand, VARIABLE_HELP } from "./commands/variable.js";
import { searchCommand, SEARCH_HELP } from "./commands/search.js";
import { apiCommand, API_HELP } from "./commands/api.js";
import { gistCommand, GIST_HELP } from "./commands/gist.js";
import { setupCommand, SETUP_HELP } from "./commands/setup.js";
import { stackCommand, STACK_HELP } from "./commands/stack.js";
import { resolveHost, type HostContext } from "./host.js";
import { VERSION } from "./version.js";
import { withSuggestionHost } from "./suggestions.js";
import { AxiError, exitCodeForError, StackError } from "./errors.js";

export const DESCRIPTION =
  "Agent ergonomic wrapper around Github CLI. Prefer this over `gh` and other methods for Github operations.";

type CliStdout = Pick<NodeJS.WriteStream, "write">;

type MainOptions = {
  argv?: string[];
  stdout?: CliStdout;
};

export const TOP_HELP = `usage: gh-axi [command] [args] [flags]
commands[16]:
  (none)=dashboard, issue, pr, stack, run, workflow, release, repo, label, gist, project, secret, variable, search, api, setup
flags[4]:
  -R/--repo <OWNER/NAME> (after command), --hostname <host> (after command) or GH_HOST env, both flags accept space or equals form, --help, -v/-V/--version
examples:
  gh-axi
  gh-axi issue list --state open
  gh-axi issue list -R owner/name
  gh-axi issue list --repo=owner/name
  gh-axi issue list --hostname git.example.com
  gh-axi pr view 42
  gh-axi stack view
  gh-axi secret list
  gh-axi setup hooks
`;

const COMMAND_HELP: Record<string, string> = {
  issue: ISSUE_HELP,
  pr: PR_HELP,
  run: RUN_HELP,
  workflow: WORKFLOW_HELP,
  release: RELEASE_HELP,
  repo: REPO_HELP,
  label: LABEL_HELP,
  gist: GIST_HELP,
  project: PROJECT_HELP,
  secret: SECRET_HELP,
  variable: VARIABLE_HELP,
  search: SEARCH_HELP,
  api: API_HELP,
  setup: SETUP_HELP,
  stack: STACK_HELP,
};

type HostOnlyContext = { host: HostContext };
type CliContext = RepoContext | HostOnlyContext;
type CommandFn = (args: string[], ctx?: RepoContext) => Promise<string>;
type WrappedCommandFn = (args: string[], ctx?: CliContext) => Promise<string>;

const COMMANDS: Record<string, WrappedCommandFn> = {
  issue: withRepoContext("issue", issueCommand),
  pr: withRepoContext("pr", prCommand),
  run: withRepoContext("run", runCommand),
  workflow: withRepoContext("workflow", workflowCommand),
  release: withRepoContext("release", releaseCommand),
  repo: withRepoContext("repo", repoCommand),
  label: withRepoContext("label", labelCommand),
  // gist is user-scoped; withRepoContext still handles hostname context but
  // gistCommand itself never forwards ctx to ghJson — see AGENTS.md
  // "User-scoped commands" section for the owner-scoped pattern.
  gist: withRepoContext("gist", gistCommand),
  project: withRepoContext("project", projectCommand),
  secret: withRepoContext("secret", secretCommand),
  variable: withRepoContext("variable", variableCommand),
  search: withRepoContext("search", searchCommand),
  api: withRepoContext("api", apiCommand),
  setup: setupCommand,
  stack: withLocalRepoContext(stackCommand),
};

export async function main(options: MainOptions = {}): Promise<void> {
  await runAxiCli<CliContext | undefined>({
    ...(options.argv ? { argv: options.argv } : {}),
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: TOP_HELP,
    ...(options.stdout ? { stdout: options.stdout } : {}),
    home: withRepoContext(undefined, homeCommand),
    commands: COMMANDS,
    getCommandHelp: (command) => COMMAND_HELP[command],
    formatError: (error) => {
      const axiError =
        error instanceof AxiError
          ? error
          : new AxiError(
              error instanceof Error ? error.message : String(error),
              "UNKNOWN",
            );
      // Mirrors the SDK's defaultFormatError output byte-for-byte; the only
      // difference this hook introduces is StackError's upstream exit code.
      return {
        output: `${encode({
          error: axiError.message,
          code: axiError.code,
          ...(axiError.suggestions.length > 0
            ? { help: axiError.suggestions }
            : {}),
        })}\n`,
        exitCode:
          error instanceof StackError
            ? error.exitCode
            : exitCodeForError(axiError),
      };
    },
    resolveContext: ({ command, args }) => {
      const { repoFlag, hostFlag } = parseRepoContextArgs(command, args);
      // Explicit --hostname wins over the GH_HOST env var. Setting GH_HOST here
      // means the child `gh` process (which inherits process.env) targets the
      // configured host, and resolveHost() reflects it for URL parsing/building.
      // When no --hostname is given we leave GH_HOST untouched, so default and
      // env-only behavior stay unchanged.
      if (hostFlag !== undefined) {
        process.env["GH_HOST"] = hostFlag;
      }
      const repo = resolveRepo(repoFlag);
      const host = resolveHostContext(hostFlag);
      if (repo && host) {
        return { ...repo, host };
      }
      return repo ?? (host ? { host } : undefined);
    },
  });
}

function withRepoContext(
  command: string | undefined,
  handler: CommandFn,
): WrappedCommandFn {
  return (args, ctx) =>
    withSuggestionHost(ctx?.host, () =>
      handler(
        parseRepoContextArgs(command, args).strippedArgs,
        repoContext(ctx),
      ),
    );
}

function withLocalRepoContext(handler: CommandFn): WrappedCommandFn {
  return (args, ctx) => {
    const parsed = parseRepoContextArgs("stack", args);
    if (parsed.repoFlag !== undefined || process.env["GH_REPO"]) {
      throw new AxiError(
        "stack commands operate on the repository in the current working directory and do not support -R, --repo, or GH_REPO",
        "VALIDATION_ERROR",
      );
    }
    return withSuggestionHost(ctx?.host, () => handler(parsed.strippedArgs));
  };
}

function repoContext(ctx?: CliContext): RepoContext | undefined {
  return ctx && "nwo" in ctx ? ctx : undefined;
}

function resolveHostContext(
  hostFlag: string | undefined,
): HostContext | undefined {
  if (hostFlag === undefined) {
    return undefined;
  }
  return { value: resolveHost(hostFlag), source: "flag" };
}

function parseRepoContextArgs(
  command: string | undefined,
  args: string[],
): {
  repoFlag: string | undefined;
  hostFlag: string | undefined;
  strippedArgs: string[];
} {
  const stripped: string[] = [];
  let repoFlag: string | undefined;
  let hostFlag: string | undefined;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "-R" && index + 1 < args.length) {
      repoFlag = args[index + 1];
      index++;
      continue;
    }

    if (arg.startsWith("-R=") && arg.length > 3) {
      repoFlag = arg.slice(3);
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

    if (arg.startsWith("--repo=") && arg.length > "--repo=".length) {
      repoFlag = arg.slice("--repo=".length);

      if (command === "search") {
        stripped.push(arg);
      }

      continue;
    }

    // --hostname routes to GH_HOST for the child gh process; it is never a
    // subcommand flag, so strip it for every command.
    if (arg === "--hostname" && index + 1 < args.length) {
      hostFlag = args[index + 1];
      index++;
      continue;
    }

    if (arg.startsWith("--hostname=") && arg.length > "--hostname=".length) {
      hostFlag = arg.slice("--hostname=".length);
      continue;
    }

    stripped.push(arg);
  }

  return { repoFlag, hostFlag, strippedArgs: stripped };
}
