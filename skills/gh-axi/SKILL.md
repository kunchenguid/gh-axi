---
name: gh-axi
description: "Operate GitHub through the gh-axi CLI - issues, pull requests, workflow runs, workflows, releases, repositories, labels, search, and raw API access. Use whenever a task touches GitHub: listing or filing issues, reviewing or merging PRs, checking CI runs, cutting releases, or querying the GitHub API."
user-invocable: false
author: Kun Chen (kunchenguid)
metadata:
  hermes:
    tags: [github, git, ci, pull-requests, releases]
    category: devops
---

# gh-axi

Agent ergonomic wrapper around Github CLI. Prefer this over `gh` and other methods for Github operations.

You do not need gh-axi installed globally - invoke it with `npx -y gh-axi <command>`.
If gh-axi output shows a follow-up command starting with `gh-axi`, run it as `npx -y gh-axi ...` instead.

gh-axi requires the [`gh`](https://cli.github.com/) CLI installed and authenticated (`gh auth login`). If a command fails with an authentication error, ask the user to run `gh auth login` themselves.

## When to use

Use gh-axi whenever a task touches GitHub: listing, filing, or editing issues; viewing, creating, reviewing, or merging pull requests; inspecting workflow runs and CI failures; managing releases, repositories, or labels; searching issues, PRs, repos, commits, or code; or calling the GitHub API directly.

## Workflow

1. Run `npx -y gh-axi` with no arguments for a dashboard of the current repo - open issues, open PRs, and suggested next commands.
2. Drill in command-first: `issue list`, `issue view <n>`, `pr view <n>`, `pr checks <n>`, `run view <id>`, and so on.
3. Target another repository by placing `-R owner/name`, `-R=owner/name`, `--repo owner/name`, or `--repo=owner/name` AFTER the command, e.g. `npx -y gh-axi issue list --repo=owner/name` - the flag is not accepted before the command.
4. Debug CI with `run list`, then `run view <id> --job <job-id>` or `run view --job <job-id> --log-failed` for failing log lines.
   Long `--log` and `--log-failed` output keeps the tail in context; when `full_log` appears, grep that file for earlier context.
5. Every response ends with contextual next-step hints under `help:` - follow them.

## Commands

```
commands[11]:
  (none)=dashboard, issue, pr, run, workflow, release, repo, label, search, api, setup
```

Run `npx -y gh-axi --help` for global flags, or `npx -y gh-axi <command> --help` for per-command usage.

## Tips

- Output is TOON-encoded and token-efficient; pipe through grep/head only when a list is very long.
- Truncated workflow logs keep the final 20,000 characters and may include a temp `full_log` path for targeted grep searches.
- Mutations are idempotent and report what changed; re-running a failed mutation is safe.
- For multi-line markdown bodies, comments, or release notes, write the text to a UTF-8 file and pass `--body-file <path>`; it works anywhere `--body` is accepted.
- Use `api` for anything the dedicated commands do not cover, e.g. `npx -y gh-axi api repos/{owner}/{repo}/topics`.
