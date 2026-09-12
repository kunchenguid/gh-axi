# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Dependency bumps and the lockfile

The committed `pnpm-lock.yaml` is Prettier-formatted (multi-line `resolution:` and `engines:` blocks), which is not pnpm's native output format.
A plain `pnpm install` rewrites those blocks inline and produces a ~1000-line cosmetic churn even when only one dependency actually changed.
After bumping a dependency, run `pnpm exec prettier --write pnpm-lock.yaml` so the diff collapses to just the real change.
CI uses `pnpm install --frozen-lockfile`, which parses the YAML structurally and accepts the Prettier-formatted lockfile, so the formatting does not break the frozen-install check.

## The SDK-provided `update` command

`gh-axi` runs its CLI through `runAxiCli` from `axi-sdk-js` (`src/cli.ts`) and registers no `update` command of its own.
Since `axi-sdk-js@0.1.8` ships `update` as a `RESERVED_COMMANDS` built-in, `gh-axi` inherits `gh-axi update` for free, and the SDK auto-resolves the npm package name (`gh-axi`) by walking up to the nearest `package.json`.
The SDK also appends a `"built-in":` section to the top-level `--help` output at runtime, so `src/cli.ts`'s `TOP_HELP` constant is a prefix of the rendered help rather than the whole thing.

## Release process

Releases are cut by release-please from conventional commit messages on `main`; merging the bot's release PR triggers `npm publish` via `.github/workflows/release-please.yml`.
Do not hand-edit `CHANGELOG.md` or `.release-please-manifest.json` (a guard workflow blocks PRs that touch them), and regenerate `skills/gh-axi/SKILL.md` with `pnpm run build:skill` instead of editing it directly.

Every `pull_request` workflow (`ci.yml`, `guard-generated-files.yml`, `no-mistakes-required.yml`) uses `paths-ignore` for the release-please output set (`.release-please-manifest.json`, `CHANGELOG.md`, `package.json`) so release PRs create zero runs. Job-level bot `if`s stay as defense in depth. `test/release-ci-exclusions.test.ts` derives that set from `release-please-config.json` and fails if a workflow drifts; update the ignore lists when adding `extra-files` or changing `release-type`.

## Installable skill (`src/skill.ts` → `skills/gh-axi/SKILL.md`)

The shipped skill stays a minimal stub and defers to the CLI for all actual guidance. gh-axi CLI output (`gh-axi` dashboard, `gh-axi --help`, `gh-axi <command> --help`) is the single source of truth. Never re-duplicate CLI-owned instructions into the skill; prefer a pointer over restated detail.

## GitHub Enterprise host support (`src/host.ts`, `src/cli.ts`)

`gh-axi` targets a custom GitHub host (e.g. a GHE server like `ghe.example.com`) via a global `--hostname <host>` flag or the `GH_HOST` env var; explicit `--hostname` wins.
Like `-R`/`--repo`, `--hostname` must come _after_ the command (the SDK rejects leading flags), and it is stripped from the args before they reach the underlying `gh` (it is never a subcommand flag).
`src/cli.ts`'s `resolveContext` sets `process.env.GH_HOST` only when `--hostname` is present; the child `gh` process inherits `process.env`, so no explicit env is threaded through `gh.ts`. When no `--hostname` is given, `GH_HOST` is left untouched, keeping the default (github.com) behavior byte-for-byte identical.
`src/host.ts#resolveHost()` (flag > `GH_HOST` > `github.com`) is the single source of truth for the effective host used when _building or parsing_ URLs — `parseRemoteUrl` in `src/context.ts` matches the configured host in `git remote` URLs, and `issue transfer`'s fallback URL is built as `https://<host>/...`. The `gh pr create` output regex (`/pull/(\d+)/`) is already host-agnostic.

## Secret/variable value input (`src/secretValue.ts`, `src/stdin.ts`, `gh.ts#ghExecWithStdin`)

`gh secret list`/`gh variable list` do not support `--limit` or any pagination flag (unlike `issue`/`pr`/`release` list), so `secret.ts`/`variable.ts` list all results in one call with no `--limit` flag of their own.

Secret values must never appear in argv (visible via `ps`) or stdout.
`secretCommand`'s `set` subcommand is stdin-only: it rejects `--body`/`-b`, calls `resolveValue(undefined, "secret")`, and pipes the resolved value to `gh.ts#ghExecWithStdin` so the wrapped `gh secret set` child also never receives the value in argv.
Variable values are not treated as secrets: `variableCommand`'s `set` subcommand may resolve the value from `--body`/`-b` or piped stdin (`resolveValue` in `src/secretValue.ts`, backed by `src/stdin.ts`), and `gh-axi variable list` intentionally prints variable values.
`variable set --body` values are visible in the `gh-axi` process argv, but `ghExecWithStdin` still keeps them out of the child `gh variable set` argv.
`resolveValue` throws immediately instead of blocking when stdin is an interactive TTY and no usable value source was provided, since AXI commands must never hang waiting for interactive input.

`secretCommand`'s `list`/`set`/`delete` forward `--env`/`-e <environment>` to `gh secret ... --env` via `resolveScope` in `src/commands/secret.ts`; the repo/host context flags are already stripped in `cli.ts` before the command sees its args, so `-R`/`--hostname` compose with `--env` for free. `resolveScope` is deliberately strict: a malformed `--env` (missing/empty value), conflicting `--env` flags, gh's other scopes (`--org`/`--user`/`--app`, plus the value-channel `--env-file`), and any unknown flag all throw loudly rather than silently falling back to repo scope. Unknown flags are echoed by name only (the `=value` is stripped) so a secret value can never leak into an error message.

## User-scoped commands (`src/commands/gist.ts`, `src/commands/project.ts`)

Some GitHub API endpoints are user-scoped rather than repo-scoped: `gh api /gists` and `gh project` have no `--repo` flag and reject it if supplied.
`gh.ts#buildArgs` auto-appends `--repo <nwo>` for any `RepoContext` whose `source !== "git"`, so passing ctx to `ghJson` from these handlers would inject a flag the CLI rejects.
The fix is structural: these command functions omit the `ctx` parameter entirely (TypeScript accepts `(args: string[])` as `CommandFn` because fewer params are always assignable).
`cli.ts`'s `withRepoContext` wrapper still resolves a context for other commands — it just never reaches `ghJson` in the user-scoped handlers.
`gist.ts` follows this pattern; `project.ts` does too (though it additionally uses ctx?.owner for owner defaulting, it never forwards ctx to `ghJson`).

## GitHub Projects (`gh project`) support (`src/commands/project.ts`)

Unlike every other command family, `gh project` is owner-scoped (`--owner <login>`), not repo-scoped — it has no `--repo` flag at all.
`project.ts`'s subfunctions therefore never pass `RepoContext` as the second arg to `ghJson` (matching `search.ts`'s existing pattern) — see "User-scoped commands" above for why.
Instead, `resolveOwner()` defaults `--owner` to the current repo's owner (`ctx?.owner`) when the flag is omitted and a repo context is available, falling back to explicit `@me` otherwise because `gh project` requires an owner in non-interactive shells.
`gh project` subcommands use `--format json` (whole-object dump), not the `--json field,field` selection style used by `issue`/`pr`/`release`; list-shaped responses come back wrapped (e.g. `{ projects: [...], totalCount }`), not as a bare array.
Since Projects v2 items carry per-project custom fields (Status, Priority, ...) with no fixed schema, `item-list`/`field-list` render through bespoke functions (`renderProjectItems`/`renderProjectFields`) that flatten any unknown scalar top-level key into its own column, rather than a fixed `FieldDef` schema.
Requires the `project` (or `read:project`) OAuth scope on the `gh` token; `src/errors.ts` matches gh's literal `"authentication token is missing required scopes [...]"` stderr (verified against a live token missing the scope) and maps it to `FORBIDDEN` with a `gh auth refresh -s <scope>` suggestion — this pattern is generic, not project-specific, so it also covers other gh features gated by OAuth scopes.

## Help text is the flag contract (`test/help-examples.test.ts`)

Agents read `--help` as the complete list of flags a subcommand accepts, so every entry in a family's `*_FLAGS` table must appear in the matching `flags{<sub>}:` section of its `*_HELP` string.
`test/help-examples.test.ts` enforces that direction (FLAGS subset of HELP) by importing the tables themselves — which is the only reason `ISSUE_FLAGS`, `PR_FLAGS`, `RUN_FLAGS`, `WORKFLOW_FLAGS`, `RELEASE_FLAGS`, `REPO_FLAGS`, `LABEL_FLAGS`, `PROJECT_FLAGS`, `VARIABLE_FLAGS` and `SEARCH_FLAGS` are exported.
The parser reads a `flags{<sub>}:` header naming exactly one subcommand plus its two-space-indented continuation lines; matching is whole-token, so `--log-failed` does not stand in for `--log`.
`issue list --search` and `pr list --search` are exempt via `UNDOCUMENTED_ON_PURPOSE` because they exist only to be rejected with a hint pointing at `gh-axi search`; add an exemption only for a flag that always fails, never to silence a real gap.
`api`, `gist`, `secret` and `stack` declare their accepted flags differently and are not covered.

## Repeatable flags (`src/args.ts`)

`gh` accepts `--label`, `--assignee`, `--reviewer`, `--project`, and the `--add-*`/`--remove-*` variants once per value, so gh-axi must collect _every_ occurrence.
Use `getAllFlags`/`takeAllFlags` plus `pushRepeated`; `getFlag`/`takeFlag` keep only the first occurrence and silently discard the rest, which is the bug that recurred as #55, #57, and #75.
Both collectors reject a dangling (`--label` with nothing after it) or blank (`--label=`) value with a `VALIDATION_ERROR` instead of dropping it.
Pick the collector that matches the surrounding file: `issue.ts` reads args non-destructively (`getAllFlags`), `pr.ts` consumes them (`takeAllFlags`).
When a flag becomes repeatable, mark it `(repeatable)` in that command's `*_HELP` string.

## Local guards on pass-through flags (`src/commands/pr.ts`)

gh rejects some flag combinations at parse time (`--merge`/`--squash`/`--rebase`, and `--auto`/`--disable-auto`/`--admin`), and gh-axi mirrors those conflicts locally as a `VALIDATION_ERROR` before any gh call.
The mirror is not redundant: several commands run an idempotency `gh ... view` first, so a locally caught conflict saves an API round trip and yields a mapped error instead of gh's raw flag usage dump.
Verify the real conflict against the installed gh (`gh pr merge 999999 --admin --auto -R <repo>` surfaces a flag error without touching a PR) rather than inferring it from the help text.

`takeBoolFlag` in `src/args.ts` matches whole tokens only, while `rejectUnknownFlags` compares the flag name with any `=value` stripped, so a known boolean written as `--flag=value` clears the guard and is then dropped without a word.
`prMerge` closes that gap for its own on/off switches with `rejectValuedMergeSwitches`, which throws a `VALIDATION_ERROR` naming the offending token before any gh call; a command adding its own boolean flag needs the same guard until the shared helper learns the `=value` form.
Run such a guard over the raw argv as the first statement of the handler: once a value-taking option has parsed, `--body --admin=true` has already been consumed as body text and there is no token left to reject.

## gh stderr classification (`src/errors.ts`)

`mapGhError` walks `patterns` in order and returns on the first regex hit, so **order is the contract**: a narrow, specific pattern must sit ahead of any broader one it would otherwise be swallowed by.
gh sometimes embeds remediation hints in errors with a different root cause, so check new patterns against real stderr and place specific carriers of a generic hint first rather than narrowing the generic match.
`test/errors.test.ts` pins the repo-resolution and genuine-auth cases.

## `--version` fast path (`bin/gh-axi.ts`, `src/version.ts`)

`bin/gh-axi.ts` answers a bare `-v`/`-V`/`--version` via `tryFastPath` from `axi-sdk-js/fast-path` (a dependency-free SDK subpath) and only `await import("../src/cli.js")` otherwise, so the version path never loads the command graph (~31ms -> ~20ms, the node floor).
This only works because `src/version.ts` is a LEAF module importing node builtins only - `cli.ts` imports `VERSION` from it, never the reverse. Adding any non-builtin import to `src/version.ts` silently undoes the speedup.
`test/version-fast-path.test.ts` guards it deterministically with a `module.register()` load-hook trace (`test/fixtures/module-trace-*.mjs`) plus a negative control on `--help`. Do not add a wall-clock timing assertion; it was proven flaky under CI contention.

## Stacked PR support (`src/commands/stack.ts`)

`gh-axi stack` is deliberately a strict adapter over the official `github/gh-stack` extension, not a second stack engine. Keep local metadata, Git mutation, rebase recovery, and Stacks API behavior upstream.
Stack commands are cwd-bound. `cli.ts#withLocalRepoContext` rejects explicit repo flags and `GH_REPO`, strips the supported host flag, and never passes a `RepoContext` to `ghRaw`, because the extension does not accept `--repo`.
Successful extension status is commonly written to stderr, and exits 2-10 represent actionable stack state. Preserve both streams and the exact `StackError.exitCode`, which reaches the shell only through `cli.ts`'s `formatError` hook; do not replace `ghRaw` with `ghExec` or generic `mapGhError`.
Never expose an interactive path. Force `view --json`, `submit --auto`, and `merge --yes`; require arguments for commands that otherwise prompt. Keep `modify`, `switch`, `alias`, and `feedback` out unless upstream gains a useful headless interface.

## Repeatable `--attach` (`src/attach.ts`)

`--attach <path[#alt]>` is repeatable on `issue`/`pr` `create`, `edit`, and `comment` (gh itself does not offer it on `pr review`). gh-axi checks the wrapped binary (`GH_BIN` or `gh` on PATH) is >= 2.99.0 before validation, then forwards values unchanged so gh owns parsing, validation, and upload behavior. Tests resolve that binary from `GH_BIN`, then a worktree `.tools/gh-2.99.0/**/bin/gh`, then PATH. Live upload tests also need `GH_AXI_TEST_REPO` set to a captain-owned test repo, never a product repo.

## Raising PRs to upstream

Human-authored PRs targeting `main` must be raised through [`no-mistakes`](https://github.com/kunchenguid/no-mistakes) (`no-mistakes init --fork-url git@github.com:<you>/gh-axi.git`, then `git push no-mistakes`): the `Require no-mistakes` workflow fails any PR whose body lacks the pipeline's deterministic signature, and maintainer triage treats hand-raised PRs as blocked. Do not push a PR branch straight to `origin`. See CONTRIBUTING.md.

`.github/workflows/no-mistakes-required.yml` is a thin caller of the shared `kunchenguid/no-mistakes/.github/actions/require-no-mistakes` composite action, pinned to an immutable commit SHA and never `@main` (main is editable by the very PR the gate judges). Enforcement logic - the `Updates from [git push no-mistakes]` signature check, the `<!-- no-mistakes-pipeline-attestation:v1 {...} -->` parse, and the head binding - and its tests live upstream in the no-mistakes repository; change enforcement there rather than copying it locally, and bump this repository's pin in a deliberate separate pull request. This repository still owns its `on:`, `paths-ignore`, `concurrency`, `permissions`, job name, and author-exemption `if:`.
The shared action's head binding means a PR whose body no-mistakes did not rewrite for the current head goes red. That is the attestation contract, not a flake: push through `git push no-mistakes` so the body is refreshed.

## The glab-axi sibling package (`glab-axi/`)

`glab-axi` is a pnpm workspace package (`pnpm-workspace.yaml` lists it) mirroring gh-axi's architecture around GitLab's `glab`: same `runAxiCli` registry, TOON helpers, suggestion table, `mapGlabError` pattern order, and `rejectUnknownFlags` discipline. Root commands cover it: `pnpm run build` chains `pnpm --filter glab-axi build`, root vitest and eslint pick up `glab-axi/` (the package declares no test script of its own — vitest is a root devDependency and is not linked into `glab-axi/node_modules/.bin`), and its skill stub regenerates via `pnpm --filter glab-axi build:skill`. `release-please-config.json` still lists only the root package, so `glab-axi` is built and tested in CI but never published by the release workflow.

Deltas grounded in verified glab behavior (glab 1.117, live-checked):

- Identity is (host, full path, number), not owner/repo: `ProjectContext.fullPath` nests arbitrarily (`group/sub/project`); `buildArgs` appends `-R <fullPath>` for flag/env sources only; `--hostname` maps to `GITLAB_HOST` for the child glab (explicit flag wins, env untouched otherwise).
- glab has no field selector: read JSON with `-F json` — except `glab issue list`, whose `-F` means `details|ids|urls` and whose JSON flag is `-O json`. Parse in-process; there is no `--json` field selection to trim.
- State checks (`mr merge/close/reopen`, `issue close`) compare the exact normalized value (`=== "merged"`), never a substring, so an output-format change degrades to attempting the mutation instead of a false-positive no-op.
- Mutation handlers never let glab prompt: `create` commands always forward a concrete `--description` (default `""`) plus `--yes`; `mr merge` passes `--auto-merge=false` by default (glab auto-merges when a pipeline runs) and `--auto-merge=true` only for `--auto`. That call returns before the merge happens, so `--auto` renders a `merge_scheduled` block with `status: scheduled` and a suggestion to check the MR — never `merged`. Valued boolean switches (`--squash=false`, `--full=true`) are rejected by `takeBoolFlag` itself, before any glab call: `rejectUnknownFlags` strips `=value` before comparing, so nothing else would catch them. `rejectUnknownFlags` and every value reader in `args.ts` (`takeRequiredFlag`, `takeAllFlags`) decide "this token is another flag" with one flag-shaped test (`^--?[A-Za-z]`): a dangling `--author --state merged` throws instead of filtering by an author named `--state`, while a bulleted markdown body (`--description "- fixes the redirect"`) stays ordinary text. Every reader consumes what it reads, so each handler ends its parsing with `onlyPositional` (subcommands taking one number) or `rejectPositionals` (list/create): a stray `mr list closed` throws instead of returning the default opened set.
- An explicit project selector never degrades: `context.ts#parsePath` throws for an unparseable `-R`/`--repo`/`GITLAB_REPO` value, because resolving no project makes the child glab auto-detect the cwd project and land a mutation on the wrong one. A URL selector is forwarded to glab verbatim: glab resolves `-R https://gitlab.corp.com/team/app` against the host it names, but reads a `HOST/PATH` prefix as part of the project name and asks the configured host for it (live-verified — `-R salsa.debian.org/salsa/support` 404s on gitlab.com while the URL form works), so neither stripping the host nor rewriting the URL to `HOST/PATH` is safe. Only `parseRemoteUrl` (git auto-detection) may return `undefined`. The SDK calls `resolveContext` outside its per-command error handling, so `cli.ts#main` wraps `runAxiCli` to render that throw through the same `formatError` envelope.
- `glab api --paginate` emits one JSON document per page, not gh's single merged array: array pages (`[{...}][{...}]`) concatenate into one list, object pages (`graphql --paginate` writes `{"data":...}{"data":...}`) become one entry per page. `api.ts` splits both before shaping, so TOON rendering and the `runners_token` redaction still apply across pages; the raw-text envelope is reserved for text that does not split into JSON documents at all.
- GitLab now serves an issue's `web_url` in work-items form (`/-/work_items/<iid>`), while merge requests keep `/-/merge_requests/<iid>`. `glab issue create` prints only that URL in non-TTY mode, so `issue.ts` matches both issue spellings and, when it recognizes neither, reads the new issue back by URL (`glab issue view <url>`) rather than by a `0` that is guaranteed to 404. `mr create` reads back the same way.
- glab reads the request body from its own stdin for `--input -` and `--field k=@-`. `api.ts` relays what was piped to glab-axi through `glabExec`'s third argument, and refuses those forms when stdin is a TTY — forwarding `-` with a closed pipe would send an empty body and silently no-op the mutation.
- Not-found stderr differs per command family: `mr view` names the entity (`Failed to get merge request 999999: 404 Not Found.`) while `issue view` prints only a bare `404 Not Found.` banner. Worse, `issue list` against a missing project emits that same bare banner, so `mapGlabError` takes the invocation (`<family> <subcommand>`, the first two argv tokens, passed from `glab.ts`) and a pattern may set `commands:` to scope itself. The issue-404 entry is the only one that needs it, listing just the subcommands that name an issue (`issue view`, `issue close`) so list/create fall through to the project-path message; it must also stay below the `404 Project Not Found` entry. The `mr view` prefix is not itself a 404 signal — glab wraps every reason in it (`Failed to get merge request 1: GET ...: 401 {message: 401 Unauthorized}.`), so that entry requires a `404` inside the wrapped reason and a 401/403/429 falls through to the status entries.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
