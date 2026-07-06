<h1 align="center">gh-axi</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/gh-axi"><img alt="npm" src="https://img.shields.io/npm/v/gh-axi?style=flat-square" /></a>
  <a href="https://github.com/kunchenguid/gh-axi/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/kunchenguid/gh-axi/ci.yml?style=flat-square&label=ci" /></a>
  <a href="https://github.com/kunchenguid/gh-axi/actions/workflows/release-please.yml"><img alt="Release" src="https://img.shields.io/github/actions/workflow/status/kunchenguid/gh-axi/release-please.yml?style=flat-square&label=release" /></a>
  <a href="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue?style=flat-square"><img alt="Platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue?style=flat-square" /></a>
  <a href="https://x.com/kunchenguid"><img alt="X" src="https://img.shields.io/badge/X-@kunchenguid-black?style=flat-square" /></a>
  <a href="https://discord.gg/Wsy2NpnZDu"><img alt="Discord" src="https://img.shields.io/discord/1439901831038763092?style=flat-square&label=discord" /></a>
</p>

GitHub CLI for agents — designed with [AXI](https://github.com/kunchenguid/axi) (Agent eXperience Interface).

Wraps the official `gh` cli with token-efficient TOON output, contextual next-step suggestions, and structured error handling.
Built for autonomous agents that interact with GitHub via shell execution.

## Benchmarks

Agent ergonomics is measurable.
The [axi benchmark](https://axi.md) runs the same 17 real-world GitHub tasks (issue triage, PR review prep, CI failure investigation, and more) through 5 GitHub interface setups - 5 repeats each, with `claude-sonnet-4-6` as the agent and an LLM judge scoring task success.

gh-axi posts the lowest input tokens, cost, and duration of all 5 conditions, and is the only one to pass every run:

| Condition                  | Avg Input Tokens | Avg Cost/Task | Avg Duration | Avg Turns | Success  |
| -------------------------- | ---------------- | ------------- | ------------ | --------- | -------- |
| **gh-axi**                 | **46,462**       | **$0.050**    | **15.7s**    | **3**     | **100%** |
| gh CLI (raw)               | 47,076           | $0.054        | 17.4s        | 3         | 86%      |
| GitHub MCP code execution  | 137,409          | $0.101        | 43.4s        | 7         | 84%      |
| GitHub MCP + ToolSearch    | 153,621          | $0.147        | 41.1s        | 8         | 82%      |
| GitHub MCP (eager schemas) | 175,757          | $0.148        | 34.2s        | 6         | 87%      |

Against raw `gh` - the very CLI this tool wraps - that is 100% vs 86% task success at 7% lower cost.
Against the GitHub MCP server it is 66% cheaper, with 74% fewer input tokens and half the turns.

## Quick Start

Install the gh-axi skill in the [Agent Skills](https://agentskills.io) format with [`npx skills`](https://github.com/vercel-labs/skills):

```sh
npx skills add kunchenguid/gh-axi --skill gh-axi -g
```

That is the entire setup - no npm install needed.
The skill teaches your agent to run gh-axi through `npx -y gh-axi`, so the CLI comes along on demand.
You still need [`gh`](https://cli.github.com/) installed and authenticated via `gh auth login` (Node 20+ required).
For GitHub Enterprise or another custom host, authenticate `gh` for that host and either pass `--hostname <host>` after the command or set `GH_HOST`.

The skill is not a user-facing slash command (`user-invocable: false`).
Its frontmatter also includes Hermes Agent metadata (`metadata.hermes`) so Hermes can categorize it as a `devops` skill for GitHub, git, CI, pull requests, and releases.
Just ask for anything that touches GitHub - filing issues, reviewing PRs, checking CI runs, cutting releases, or managing GitHub Actions secrets and variables - and the agent loads the skill on its own when it recognizes the task.

`-g` installs the skill for all projects (`~/.claude/skills/`, for example); drop it to install for the current project only (`.claude/skills/`).

## Other Ways to Install

The skill is the recommended path, but it is not the only one.

### Zero setup

gh-axi is an AXI, so any capable agent can run the CLI directly with nothing installed at all.
Just tell your agent:

```
Execute `npx -y gh-axi` to get GitHub tools.
```

### Session hook

Want ambient GitHub context - the current repo's open issues and PRs - fed into every agent session instead of loading on demand?
Install the CLI globally and opt into the hook:

```sh
npm install -g gh-axi
gh-axi setup hooks
```

This installs a `SessionStart` hook for **Claude Code**, **Codex**, and **OpenCode** that surfaces the current repo state and usage guidance at the start of each session.
**Restart your agent session after running this** so the new hook takes effect.
For global installs, run `gh-axi update --check` to see whether a newer release is available, or `gh-axi update` to upgrade.

## Usage

```bash
gh-axi                          # dashboard - live state, no args needed
gh-axi issue list               # list issues in current repo
gh-axi issue subissue list 16   # list sub-issues for issue #16
gh-axi pr view 42               # view pull request #42
gh-axi run list -R owner/repo   # list workflow runs for a specific repo
gh-axi issue list --hostname git.example.com  # target a GitHub Enterprise host
gh-axi run view 123456 --job 789012       # inspect a single job within a run
gh-axi run view --job 789012 --log-failed # show failed log lines for one job
gh-axi workflow run ci.yml --ref main     # trigger a workflow
echo -n "sk-..." | gh-axi secret set OPENAI_API_KEY  # set a secret from stdin
gh-axi variable set NODE_ENV --body production        # set a variable from a flag
gh-axi setup hooks              # install optional agent session hooks
gh-axi update --check           # check whether a newer release exists
gh-axi update                   # upgrade a global install
```

For multi-line issue, PR, review, or comment text, write Markdown to a UTF-8 file and pass `--body-file <path>` on the relevant command.
For releases, `--body` and `--body-file` are aliases for release notes, alongside `--notes` and `--notes-file`.
For multi-line variable values, pipe stdin to `gh-axi variable set <name>`; `--body`/`-b` is for inline values only.

Long `run view --log` and `run view --log-failed` output shows the last 20,000 characters so CI failures stay visible.
When truncation happens, gh-axi best-effort saves the complete log to a temp file, includes it as `full_log`, and prints a `help:` hint telling agents to grep that file for earlier context.
`gh-axi run` manages existing workflow runs; use `gh-axi workflow run <name> --ref <ref>` to trigger (dispatch) a workflow.

`gh-axi secret set <name>` reads the value only from piped stdin because secret flags would be visible in the `gh-axi` process argv.
`gh-axi secret list` never prints values, matching `gh secret list`.
`gh-axi variable` accepts `--body`/`-b` or piped stdin, and variable values are shown in `list` output because variables are not secret.

### Commands

| Command    | Description                                                                 |
| ---------- | --------------------------------------------------------------------------- |
| `issue`    | Issues — list, view, create, edit, close, reopen, comment, subissue         |
| `pr`       | Pull requests — list, view, create, merge, review, checks                   |
| `run`      | Existing workflow runs - list, view, watch, rerun, cancel, delete, download |
| `workflow` | Workflows - list, view, run (trigger), enable, disable                      |
| `release`  | Releases — list, view, create, edit, delete                                 |
| `repo`     | Repositories — list, view, create, edit, clone, fork                        |
| `label`    | Labels — list, create, edit, delete                                         |
| `secret`   | Actions secrets — list, set, delete                                         |
| `variable` | Actions variables — list, set, delete                                       |
| `search`   | Search issues, PRs, repos, commits, code                                    |
| `api`      | Raw GitHub API access                                                       |
| `setup`    | Install optional agent session hooks                                        |
| `update`   | Built-in self-update command inherited from `axi-sdk-js`                    |

### Global flags

- `--help` — show help for any command
- `-v`, `-V`, `--version` — show the installed `gh-axi` version
- `--hostname <host>` / `--hostname=<host>` — target a custom GitHub host; explicit flags win over `GH_HOST`

Repository and host targeting are command-first too:

- `gh-axi issue list -R owner/name`
- `gh-axi issue list --repo owner/name`
- `gh-axi issue list --repo=owner/name`
- `gh-axi run list -R owner/name`
- `gh-axi search issues "login bug" --repo owner/name`
- `gh-axi issue list --hostname git.example.com`

When a command also needs a destination repository, use a dedicated flag for it:

- `gh-axi issue transfer 42 -R source/repo --to-repo dest/repo`

## Development

```sh
pnpm run build       # Compile TypeScript to dist/
pnpm run build:skill # Regenerate skills/gh-axi/SKILL.md from shared skill source
pnpm run dev         # Run CLI directly with tsx
pnpm test            # Run tests with vitest
pnpm run test:watch  # Run tests in watch mode
```

The committed `skills/gh-axi/SKILL.md` is generated by `pnpm run build:skill`; `pnpm test` fails if it drifts from the shared CLI guidance or generated skill frontmatter.
The npm package includes `skills/gh-axi/`, so published releases ship the same installable Agent Skill documented in Quick Start.

## License

MIT
