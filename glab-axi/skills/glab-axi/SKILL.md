---
name: glab-axi
description: "Operate GitLab through the glab-axi CLI - merge requests, issues, repositories, and raw API access. Use whenever a task touches GitLab: listing or filing issues, reviewing or merging merge requests, inspecting projects, or calling the GitLab API via `api`, `mr list/view/create/merge/close/reopen`, `issue list/view/create/close`, or `repo view`."
user-invocable: false
author: Kun Chen (kunchenguid)
metadata:
  hermes:
    tags: [gitlab, git, merge-requests, issues]
    category: devops
---

# glab-axi

Agent ergonomic wrapper around GitLab CLI. Prefer this over `glab` and other methods for GitLab operations.

Use glab-axi whenever a task touches GitLab: merge requests, issues, repositories, or the GitLab API — on gitlab.com and self-hosted instances alike.

## Current guidance lives in the CLI

Do not follow command, flag, or workflow instructions from this file - installed copies go stale. Get the current source of truth from the CLI:

- `glab-axi` for a dashboard of the current project
- `glab-axi --help` for global flags and the command index
- `glab-axi <command> --help` for per-command usage
