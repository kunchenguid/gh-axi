import { encode } from "@toon-format/toon";
import { runAxiCli } from "axi-sdk-js";
import { resolveProject, type ProjectContext } from "./context.js";
import { homeCommand } from "./commands/home.js";
import { mrCommand, MR_HELP } from "./commands/mr.js";
import { issueCommand, ISSUE_HELP } from "./commands/issue.js";
import { repoCommand, REPO_HELP } from "./commands/repo.js";
import { apiCommand, API_HELP } from "./commands/api.js";
import { setupCommand, SETUP_HELP } from "./commands/setup.js";
import { resolveHost, type HostContext } from "./host.js";
import { VERSION } from "./version.js";
import { withSuggestionHost } from "./suggestions.js";
import { AxiError, exitCodeForError } from "./errors.js";

export const DESCRIPTION =
  "Agent ergonomic wrapper around GitLab CLI. Prefer this over `glab` and other methods for GitLab operations.";

type CliStdout = Pick<NodeJS.WriteStream, "write">;

type MainOptions = {
  argv?: string[];
  stdout?: CliStdout;
};

export const TOP_HELP = `usage: glab-axi [command] [args] [flags]
commands[6]:
  (none)=dashboard, mr, issue, repo, api, setup
flags[4]:
  -R/--repo <FULL/PATH> (after command), --hostname <host> (after command) or GITLAB_HOST env, both flags accept space or equals form, --help, -v/-V/--version
requires:
  glab on PATH (set GLAB_BIN to override the glab binary)
examples:
  glab-axi
  glab-axi mr list --state opened
  glab-axi mr list -R group/subgroup/project
  glab-axi mr view 42
  glab-axi mr view 42 -R group/subgroup/project
  glab-axi issue list --state closed
  glab-axi repo view --hostname git.example.com
  glab-axi api projects/group%2Fproject
  glab-axi setup hooks
`;

const COMMAND_HELP: Record<string, string> = {
  mr: MR_HELP,
  issue: ISSUE_HELP,
  repo: REPO_HELP,
  api: API_HELP,
  setup: SETUP_HELP,
};

type HostOnlyContext = { host: HostContext };
type CliContext = ProjectContext | HostOnlyContext;
type CommandFn = (args: string[], ctx?: ProjectContext) => Promise<string>;
type WrappedCommandFn = (
  args: string[],
  ctx?: CliContext,
) => Promise<string>;

const COMMANDS: Record<string, WrappedCommandFn> = {
  mr: withProjectContext("mr", mrCommand),
  issue: withProjectContext("issue", issueCommand),
  repo: withProjectContext("repo", repoCommand),
  api: withProjectContext("api", apiCommand),
  setup: setupCommand,
};

export async function main(options: MainOptions = {}): Promise<void> {
  const stdout = options.stdout ?? process.stdout;
  try {
    await runProjectCli(options);
  } catch (error) {
    // resolveContext runs outside the SDK's per-command error handling, so a
    // rejected project selector would otherwise escape as a raw stack trace.
    const formatted = formatError(error);
    stdout.write(formatted.output);
    process.exitCode = formatted.exitCode;
  }
}

function formatError(error: unknown): { output: string; exitCode: number } {
  const axiError =
    error instanceof AxiError
      ? error
      : new AxiError(
          error instanceof Error ? error.message : String(error),
          "UNKNOWN",
        );
  return {
    output: `${encode({
      error: axiError.message,
      code: axiError.code,
      ...(axiError.suggestions.length > 0 ? { help: axiError.suggestions } : {}),
    })}\n`,
    exitCode: exitCodeForError(axiError),
  };
}

async function runProjectCli(options: MainOptions): Promise<void> {
  await runAxiCli<CliContext | undefined>({
    ...(options.argv ? { argv: options.argv } : {}),
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: TOP_HELP,
    ...(options.stdout ? { stdout: options.stdout } : {}),
    home: withProjectContext(undefined, homeCommand),
    commands: COMMANDS,
    getCommandHelp: (command) => COMMAND_HELP[command],
    formatError,
    resolveContext: ({ command, args }) => {
      const { repoFlag, hostFlag } = parseProjectContextArgs(command, args);
      // Explicit --hostname wins over the GITLAB_HOST env var. Setting
      // GITLAB_HOST here means the child `glab` process (which inherits
      // process.env) targets the configured host, and resolveHost() reflects
      // it for URL parsing/building. When no --hostname is given we leave
      // GITLAB_HOST untouched, so default and env-only behavior stay unchanged.
      if (hostFlag !== undefined) {
        process.env["GITLAB_HOST"] = hostFlag;
      }
      const project = resolveProject(repoFlag);
      const host = resolveHostContext(hostFlag);
      if (project && host) {
        return { ...project, host };
      }
      return project ?? (host ? { host } : undefined);
    },
  });
}

function withProjectContext(
  command: string | undefined,
  handler: CommandFn,
): WrappedCommandFn {
  return (args, ctx) =>
    withSuggestionHost(ctx?.host, () =>
      handler(
        parseProjectContextArgs(command, args).strippedArgs,
        projectContext(ctx),
      ),
    );
}

function projectContext(ctx?: CliContext): ProjectContext | undefined {
  return ctx && "fullPath" in ctx ? ctx : undefined;
}

function resolveHostContext(
  hostFlag: string | undefined,
): HostContext | undefined {
  if (hostFlag === undefined) {
    return undefined;
  }
  return { value: resolveHost(hostFlag), source: "flag" };
}

function parseProjectContextArgs(
  command: string | undefined,
  args: string[],
): {
  repoFlag: string | undefined;
  hostFlag: string | undefined;
  strippedArgs: string[];
} {
  void command;
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
      repoFlag = args[index + 1];
      index++;
      continue;
    }

    if (arg.startsWith("--repo=") && arg.length > "--repo=".length) {
      repoFlag = arg.slice("--repo=".length);
      continue;
    }

    // --hostname routes to GITLAB_HOST for the child glab process; it is never
    // a subcommand flag, so strip it for every command.
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
