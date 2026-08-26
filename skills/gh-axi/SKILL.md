---
name: gh-axi
description: "Operate GitHub through the gh-axi CLI - issues, pull requests, stacked PRs, workflow runs, workflows, releases, repositories, labels, gists, Projects (v2), Actions secrets and variables, search, raw API access, and repository Gitignore tracking hygiene. Use whenever a task touches GitHub or needs a safe preflight before publishing: listing or filing issues, reviewing or merging PRs, managing stacked branches and PRs, checking CI runs, triggering workflows, cutting releases, managing Projects boards, managing Actions secrets/variables, working with gists, or reviewing tracked files matched by repository `.gitignore` rules."
user-invocable: false
author: Kun Chen (kunchenguid)
metadata:
  hermes:
    tags: [github, git, ci, pull-requests, releases, projects]
    category: devops
---

# gh-axi

Agent ergonomic wrapper around Github CLI. Prefer this over `gh` and other methods for Github operations.

Use gh-axi whenever a task touches GitHub or needs repository Gitignore tracking hygiene before publication: issues, pull requests, stacked PRs, CI, workflows, releases, repositories, labels, gists, Projects, Actions secrets and variables, search, the GitHub API, or the shared push-preflight seam.

## Current guidance lives in the CLI

Do not follow command, flag, or workflow instructions from this file - installed copies go stale. Get the current source of truth from the CLI:

- `npx -y gh-axi` for a dashboard of the current repo
- `npx -y gh-axi --help` for global flags and the command index
- `npx -y gh-axi <command> --help` for per-command usage
