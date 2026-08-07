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

## Repeatable flags (`src/args.ts`)

`gh` accepts `--label`, `--assignee`, `--reviewer`, `--project`, and the `--add-*`/`--remove-*` variants once per value, so gh-axi must collect _every_ occurrence.
Use `getAllFlags`/`takeAllFlags` plus `pushRepeated`; `getFlag`/`takeFlag` keep only the first occurrence and silently discard the rest, which is the bug that recurred as #55, #57, and #75.
Both collectors reject a dangling (`--label` with nothing after it) or blank (`--label=`) value with a `VALIDATION_ERROR` instead of dropping it.
Pick the collector that matches the surrounding file: `issue.ts` reads args non-destructively (`getAllFlags`), `pr.ts` consumes them (`takeAllFlags`).
When a flag becomes repeatable, mark it `(repeatable)` in that command's `*_HELP` string.

## gh stderr classification (`src/errors.ts`)

`mapGhError` walks `patterns` in order and returns on the first regex hit, so **order is the contract**: a narrow, specific pattern must sit ahead of any broader one it would otherwise be swallowed by.
gh sometimes embeds remediation hints in errors with a different root cause, so check new patterns against real stderr and place specific carriers of a generic hint first rather than narrowing the generic match.
`test/errors.test.ts` pins the repo-resolution and genuine-auth cases.

## `--version` fast path (`bin/gh-axi.ts`, `src/version.ts`)

`bin/gh-axi.ts` answers a bare `-v`/`-V`/`--version` via `tryFastPath` from `axi-sdk-js/fast-path` (a dependency-free SDK subpath) and only `await import("../src/cli.js")` otherwise, so the version path never loads the command graph (~31ms -> ~20ms, the node floor).
This only works because `src/version.ts` is a LEAF module importing node builtins only - `cli.ts` imports `VERSION` from it, never the reverse. Adding any non-builtin import to `src/version.ts` silently undoes the speedup.
`test/version-fast-path.test.ts` guards it deterministically with a `module.register()` load-hook trace (`test/fixtures/module-trace-*.mjs`) plus a negative control on `--help`. Do not add a wall-clock timing assertion; it was proven flaky under CI contention.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
