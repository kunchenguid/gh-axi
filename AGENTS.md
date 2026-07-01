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

## Secret/variable value input (`src/secretValue.ts`, `src/stdin.ts`, `gh.ts#ghExecWithStdin`)

`gh secret list`/`gh variable list` do not support `--limit` or any pagination flag (unlike `issue`/`pr`/`release` list), so `secret.ts`/`variable.ts` list all results in one call with no `--limit` flag of their own.

Secret and variable values must never appear in argv (visible via `ps`) or in stdout. `secretCommand`/`variableCommand`'s `set` subcommand resolves the value from `--body`/`-b` or piped stdin (`resolveValue` in `src/secretValue.ts`, backed by `src/stdin.ts`), then hands it to `gh.ts#ghExecWithStdin`, which writes the value directly to the `gh` child process's stdin instead of passing it as a CLI flag — this is why `gh.ts` has both `ghExec` (argv-only) and `ghExecWithStdin` (writes to the child's stdin pipe). `resolveValue` throws immediately instead of blocking when stdin is an interactive TTY and no `--body` was given, since AXI commands must never hang waiting for interactive input.
