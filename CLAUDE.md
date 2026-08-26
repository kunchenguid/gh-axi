<!-- Points Claude at AGENTS.md via import; edit AGENTS.md, not this file. -->
@AGENTS.md

<!-- modules:start -->
SIMPLE COMMUNICATION MODE ACTIVE.

Use simple, plain English. Start with the bottom line. Use short sections and bullets. Explain technical terms when they are necessary instead of assuming the user knows them.

For explanations and progress reports, clearly separate:
- what works,
- what is missing,
- why it matters,
- what happens next.

Recommend one clear next action. Keep implementation details out unless the user asks for them. Do not remove important warnings, evidence, or decisions in the name of simplicity. For direct questions that do not need all four sections, answer naturally and briefly rather than forcing a template.
<!-- modules:end -->

<!-- DEVOS_CANONICAL_START -->
<!-- DevOS:section:project-context -->
## Project Context

- **Project:** gh-axi
- **DevOS profile:** `unknown`
<!-- /DevOS:section:project-context -->

<!-- DevOS:section:skill-invocation -->
## Skill Invocation Contract

DevOS capabilities are **skills**, not executables, commands, or shell programs. Every
DevOS OS feature — including `map`, `capture`, `test`, and `devos-init` — is a
registry-routed skill. Read its `SKILL.md`, then execute that skill through the
active host's skill surface. Do not search for a binary, runner, wrapper, or
subcommand implementation.

- A line such as `map --update` is a **skill invocation with arguments**, not a
  request to run a shell command. Invoke the `map` skill with `--update`; do not
  use `command -v map`, `which map`, `map --help` in a shell, or look for a
  `runner.sh`, `run.sh`, or `map.sh`.
- To use skill `X`, read its `SKILL.md` (under `.claude/skills/X/SKILL.md`, or the
  OS-specific skills directory) and follow the instructions. Do **not** look for or
  execute a `runner.sh`, `run.sh`, or `X.sh` to "run the skill" — no such entrypoint
  exists, and running one is not how a skill executes.
- Bare skill names (`gap-analysis`, `capture`, `knowledge-pull`, `architecture-creator`)
  are **not shell commands**. `command -v gap-analysis` returning empty does **not**
  mean the skill is missing — skills are registry-routed, not on `$PATH`. Resolve a
  name against `docs/context/DEVOS_SKILLS_INDEX.json`; if it appears there, the skill
  is available. Never report a mandatory gate (e.g. `gap-analysis --dalio --fix`) as
  unavailable just because a bare name is not a shell command.
- Flags and arguments come from the skill's own `SKILL.md` (Decision Gate /
  flag table) or a script's argument parser — never from inference. A flag
  absent from that surface does not exist; do not invent one. Check whether
  the primary argument is positional, and distinguish flags a skill ACCEPTS
  from flags it PASSES DOWNSTREAM to another skill.
### Active-session and delegated-worker boundary

- The active parent session executes `/skill:<canonical-name> <exact args>` and must
  validate the matching `skill-dispatch-result/v1` before completing dependent work.
- A delegated worker is not the active host session. It MUST NOT use `command -v`,
  `which`, bare `--help`, `$PATH`, or another shell probe to test skill availability, and
  MUST NOT send slash commands to the parent. It returns a machine-readable
  `dependency_required` object with `skill`, exact `args`, `execution_owner:
  parent_active_session`, `status: not_run`, `reason: delegated_worker_boundary`, and
  `dependent_gate` plus `dependent_artifact`. The parent invokes the exact skill and
  validates its dispatch result; until then the dependent gate remains blocked.
- Never describe a delegated boundary as “host-native unavailable” or claim the dependent
  skill ran from a worker's request alone.
- When a skill surfaces an operator confirmation (e.g. "Start autonomous
  execution now?"), present it to the human verbatim and stop. Autonomous
  flags mean "run without per-step prompts", never "self-approve human
  gates".
- If a skill or chain seems to need a guard the process lacks, capture the
  gap (`capture`) or change the spec — do not bolt ad-hoc gates, locks, or
  wrappers onto generated artifacts.
- When a `SKILL.md` says it "delegates to" a script (e.g. `scripts/lib/capture.sh`),
  that script is a helper the skill tells you when and how to call. Read the `SKILL.md`
  first for the gating and validation around that call — do not run the helper directly
  as a substitute for processing the skill.
- The agent is already running inside a live active session. When the user says
  "run the skill" or invokes `/skill:<name>`, execute that skill in the current
  session immediately. Do not treat the invocation as a request for instructions,
  a shell command, or a handoff to another runtime.
- Helper scripts are not equivalent to full skill execution. Never substitute a
  helper, runner, wrapper, or direct implementation for the requested skill.
  Use a helper only when the skill's own instructions explicitly require it as
  one step of the skill execution.
- If a requested skill genuinely cannot be dispatched, STOP and say so plainly,
  naming the exact invocation attempted and the observed failure. Never improvise
  a substitute path and never continue as if the skill had run.
- Never assert a harness, host, or runtime limitation without evidence from an
  actual attempt. "I cannot invoke skills here" is a claim that requires a
  reproducible failure, not an assumption.
- Completion claims MUST be evidence-shaped. Do not say a skill "ran",
  "completed", or "passed" without showing the skill's own output or the
  resulting artifact change.
- Never hand-edit generated stamp or provenance fields (for example a
  `Generated:` header, version stamp, or anchor timestamp) to simulate a
  regeneration. Those fields are written only by the owning generation path.
- **Run DevOS shell helpers under bash, never zsh.** When a skill has you source a
  DevOS lib (`scripts/lib/*.sh`, `cli-context-regen.sh`, `profile-distribution.sh`,
  …), invoke it as `bash -lc 'source "$DEVOS_DIR/scripts/lib/<lib>.sh" && <fn>'`.
  These libs use `BASH_SOURCE[0]` and bash arrays that break when sourced directly
  in zsh — sourcing them from zsh is a top cause of broken skill runs.
- In OMP interactive mode, invoke a discovered skill with
  `/skill:<name> [args]`. Example:
  `/skill:gap-analysis --dalio --fix --area <area>`.
- `skill://<name>` is the read-only resource URL for inspecting a skill file;
  reading it is not execution evidence.
- When giving instructions to Codex, GPT, or another model operating through
  OMP, write `/skill:<name> [args]` exactly. Do not substitute a bare shell
  command or `invoke_skill(name, input)` unless the active host exposes that
  exact API.
- The active host MUST resolve the canonical skill name against the registry
  before invocation. `command -v <skill>` is not an availability check.
- A caller MUST capture and validate the invoked skill's returned or emitted
  contract before composing dependent output.
- If host-native dispatch fails, retry according to the skill contract, then
  record the exact syntax, failure mode, and fallback. Never claim the skill
  ran from a `SKILL.md` read alone.
- Every dispatched skill MUST produce a `skill-dispatch-result/v1` record in
  `product/runtime/skill-dispatch-results.jsonl` (or the canonical runtime
  equivalent), including skill, status, provider, session, summary, and evidence.
- A routing surface MUST NOT claim a dependency skill ran unless a matching
  successful or partial dispatch-result record exists.

<!-- /DevOS:section:skill-invocation -->

<!-- DevOS:section:orca-control -->
## Orca Control

When Orca is the requested control plane, use the public `orca` CLI (`orca-ide`
on Linux) and the `orca-cli` / `computer-use` skills before falling back to ad
hoc desktop tools.

- Codex and similar sandboxed sessions may be unable to reach Orca's runtime
  socket under the user's application-support directory. If `orca status --json`
  or `orca computer ... --json` reports `runtime_unavailable`,
  `stale_bootstrap`, or a connection failure from inside the sandbox, retry the
  same public `orca` / `orca-ide` command with the minimal approval/escalation
  needed before concluding Orca is down.
- Use `orca open --json` (`orca-ide open --json` on Linux) when Orca is not
  running. If the runtime points at a stale PID, prefer a graceful app
  quit/reopen, then rerun `orca status --json`.
- For read-only checks, use `orca status --json`,
  `orca computer capabilities --json`, `orca computer list-apps --json`,
  `orca computer list-windows --app <bundle> --json`,
  `orca computer get-app-state --app <bundle> --json`, `orca tab list --json`,
  `orca snapshot --page <pageId> --json`, and `orca terminal list/read --json`.
- Do not click, type, submit, send messages, delete data, change settings, or
  expose sensitive app content unless the user explicitly requested that action.
<!-- /DevOS:section:orca-control -->

<!-- DevOS:section:safety-rules -->
## Safety Rules

- Before removing or overwriting config files, create a backup first
- Never bulk-delete files without explicit approval
- Do not commit secrets (`.env`, credentials, API keys) to git
- Before staging files for a commit, verify they are inside the git repository root
- Do not force-push to main/master
- Run tests before claiming a fix works
<!-- /DevOS:section:safety-rules -->

<!-- DevOS:section:conventions -->
## Development Conventions

- Check project README and CLAUDE.md for stack-specific conventions
<!-- /DevOS:section:conventions -->

<!-- DevOS:section:directory-structure -->
## Key Directories

- `src/` — source code
- `scripts/` — build and utility scripts
- `product/` — specs, planning, runtime (DevOS managed)
- `.dev-os/` — DevOS project configuration
<!-- /DevOS:section:directory-structure -->

<!-- DevOS:section:devos-context -->
## DevOS Context

Reference these context files in every session:

- `docs/context/DEVOS_CONTEXT_BUNDLE.md` — project summary, profile, version
- `docs/context/DEVOS_CAPABILITIES_INDEX.md` — full capabilities inventory
- `docs/context/DEVOS_PUBLIC_SURFACE.md` — user-facing commands and entry points
- `docs/context/DEVOS_ARCHITECTURE.md` — system architecture and component relationships
- `docs/context/codebase-map.md` — file tree with role annotations
- `docs/context/DEVOS_OWNERSHIP_AUDIT.md` — who owns what across the codebase
- `docs/context/DEVOS_DEFERRED_TOOLS.md` — deferred HTTP MCP servers
- `docs/context/DEVOS_USER_FLOWS_STALENESS.md` — user flow freshness status
- `.dev-os/runtime/context-refresh-state.json` (logical path; resolve via `scripts/lib/runtime-state.sh`)

Already indexed in managed blocks below (no need to read separately):
Skills index, Chains index, MCP index, Standards index, Workflows index
<!-- /DevOS:section:devos-context -->

<!-- DevOS:section:compatibility-posture -->
## Compatibility Posture

- Temporary pre-launch rule. Remove or revise when this project goes live.
- This project is not live yet and has no production customers.
- Breaking changes are acceptable if they simplify the product or close correctness gaps.
- Default to the best forward version, not backwards compatibility.
- Treat unfinished, unused, or dead code as unbuilt features.
- Prefer deletion or replacement over shims, adapters, compatibility layers, or legacy fallbacks.
- Do not add legacy shims, compatibility layers, migrations, or old-contract support unless explicitly requested.
<!-- /DevOS:section:compatibility-posture -->

<!-- DevOS:section:context-artifact-commit-policy -->
## Context Artifact Commit Policy

The batchable artifact set is defined solely by the generated-artifact
classifier: `generated_artifact_classify` in `scripts/lib/generated-artifact-registry.sh`,
intent `context_commit_batch`. No surface may restate that set as a path list;
resolve it with `generated_artifact_partition_dirty` (batch and operator sets).

Commit modes — the decisive question is whether a `session-end-context-commit`
Stop hook will fire in this workspace before handoff:

- `--split` (default; interactive session staying in this worktree): commit the
  operator set; leave batchables staged for the Stop hook, which flushes them as
  `chore(context)` commits under a content-hash debounce.
- `--all` (no Stop hook will fire — CI, headless, push-and-close, worktree
  teardown, or context regeneration as the purpose of the change): one commit
  containing both sets; set `DEVOS_CONTEXT_COMMIT_MODE=all`, which the flow
  records as a `Devos-Context-Commit-Mode: all` trailer.
- `--none`: stage only; no commit. For preflight or deferred decisions.

The pre-commit hook rejects a staged set mixing batch and operator files unless
`DEVOS_CONTEXT_COMMIT_MODE` authorizes it. Env controls: `DEVOS_CONTEXT_COMMIT_FORCE=1`
flushes an active debounce immediately, `DEVOS_SKIP_CONTEXT_BATCH=1` disables the
hook batch for the session, `DEVOS_CONTEXT_BATCH_DEBOUNCE_SECONDS` overrides the
window. This block is generated from the registry — hand edits are lost on the
next refresh; change registry classes or commit mode instead.
<!-- /DevOS:section:context-artifact-commit-policy -->

<!-- DevOS:section:notepad-discipline -->
## Notepad Checkpoint Discipline

You have a durable, file-based notepad at `.dev-os/notepad.md` (project-local) or
`~/.dev-os/notepad.md` (global fallback). Three sections:

- `## PRIORITY` — always injected on session start (≤500 chars). Use for the
  current focus and active blockers, not a journal.
- `## WORKING MEMORY` — append-only, auto-pruneable. Use for milestone
  checkpoints and durable progress notes.
- `## MANUAL` — never auto-modified. Use for long-term observations.

### When to write to WORKING MEMORY

Call `notepad_write_working "<what you did and why>"` at:

1. **Task group completion** — after marking a task group `[x]` in `tasks.md`.
2. **Non-obvious decision** — after choosing between alternatives a future
   session would re-litigate without the rationale.
3. **Spec, architecture, or ADR written** — after persisting any of these.

Skip the write when the work was pure read-only research with no durable outcome.

### When to promote WORKING → PRIORITY

When a thought in WORKING MEMORY becomes a durable rule every future session
must know (an enforced convention, a project-wide constraint), call:

```bash
notepad_promote_working <timestamp_prefix>
```

This atomically moves the entry to PRIORITY (prepended, semicolon-separated)
and removes it from WORKING MEMORY. The 500-char PRIORITY cap is enforced
write-time; an over-long promotion fails loud via `notepad_enforce_priority_cap`
and you must shorten or split the entry before retrying.

### How to invoke

```bash
bash -c 'source "${DEVOS_DIR:-$HOME/.dev-os}/scripts/lib/notepad.sh" && \
  notepad_write_working "<content>"'
```

Inspect with `notepad_show_history "WORKING MEMORY" 7` (last week) or
`notepad_search "<term>"` (case-insensitive across all sections).

Do not hand-edit `.dev-os/notepad.md` — always go through the helpers to keep
the file layout and atomic-write guarantees intact.
<!-- /DevOS:section:notepad-discipline -->
<!-- DEVOS_CANONICAL_END -->

<!-- DEVOS_BUNDLE_INDEX_START -->
## Framework Bundle Index

Compact framework index for low-context providers. Read the referenced bundle files for full docs.

**claude-code-core** vlatest (23.2KB) — claude code settings, permissions, CLAUDE.md, memory, CLI flags, slash commands, interactive mode, configuration
> Full docs: `~/.dev-os/bundles/tier0_platform/claude-code-core@latest.json` — read `compressed_docs` field

**claude-code-extensions** vlatest (23.2KB) — hooks, skills, MCP, subagents, plugins, SKILL.md, hook events, MCP servers
> Full docs: `~/.dev-os/bundles/tier0_platform/claude-code-extensions@latest.json` — read `compressed_docs` field

**claude-code-automation** vlatest (23.2KB) — headless mode, agent SDK, GitHub Actions, agent teams, CI/CD, automation, best practices, workflows
> Full docs: `~/.dev-os/bundles/tier0_platform/claude-code-automation@latest.json` — read `compressed_docs` field

**claude-code-config** vlatest (23.2KB) — model config, sandboxing, checkpointing, keybindings, fast mode, status line, output styles, model aliases
> Full docs: `~/.dev-os/bundles/tier0_platform/claude-code-config@latest.json` — read `compressed_docs` field

**github-rest-api** v2026-05 (4.9KB) — github-rest-api
> Full docs: `~/.dev-os/bundles/tier2_backend/github-rest-api@2026-05.json` — read `compressed_docs` field

**vitest** vv4.1.5 (9.8KB) — Table of Contents
> Full docs: `~/.dev-os/bundles/tier2_testing/vitest@v4.1.5.json` — read `compressed_docs` field

<!-- DEVOS_BUNDLE_INDEX_END -->

<!-- DEVOS_CODEMAP_START -->

→ Codebase map not inlined here. Full map: docs/context/codebase-map.md

<!-- DEVOS_CODEMAP_END -->
