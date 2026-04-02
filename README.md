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

## Install

```bash
npm install -g gh-axi
```

Requires Node 20+ and [`gh`](https://cli.github.com/) authenticated via `gh auth login`.

Running `gh-axi` also installs or repairs Claude Code and Codex `SessionStart`
hooks. Those hooks invoke `gh-axi` directly from the packaged production build.

## Usage

```bash
gh-axi                          # dashboard — live state, no args needed
gh-axi issue list               # list issues in current repo
gh-axi pr view 42               # view pull request #42
gh-axi run list -R owner/repo   # list workflow runs for a specific repo
```

### Commands

| Command    | Description                                               |
| ---------- | --------------------------------------------------------- |
| `issue`    | Issues — list, view, create, edit, close, reopen, comment |
| `pr`       | Pull requests — list, view, create, merge, review, checks |
| `run`      | Workflow runs — list, view, rerun, cancel, watch          |
| `workflow` | Workflows — list, view, run, enable, disable              |
| `release`  | Releases — list, view, create, edit, delete               |
| `repo`     | Repositories — list, view, create, edit, clone, fork      |
| `label`    | Labels — list, create, edit, delete                       |
| `search`   | Search issues, PRs, repos, commits, code                  |
| `api`      | Raw GitHub API access                                     |

### Global flags

- `--help` — show help for any command
- `-v`, `-V`, `--version` — show the installed `gh-axi` version

Repository targeting is command-first too:

- `gh-axi issue list -R owner/name`
- `gh-axi issue list --repo owner/name`
- `gh-axi run list -R owner/name`
- `gh-axi search issues "login bug" --repo owner/name`

When a command also needs a destination repository, use a dedicated flag for it:

- `gh-axi issue transfer 42 -R source/repo --to-repo dest/repo`

## License

MIT
