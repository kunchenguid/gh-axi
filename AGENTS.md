# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

Command behavior is owned by [README.md](README.md). Contributor workflow, release-please, generated files, and implementation invariants are owned by [CONTRIBUTING.md](CONTRIBUTING.md). Follow the section named below instead of restating it here.

- [VISION.md](VISION.md) is the product scope: parity with `gh` through an AXI interface, and no GitHub capability that `gh` cannot provide.
- The installable skill stays a stub that defers to the CLI. Never restate CLI-owned instructions in `src/skill.ts` or `skills/gh-axi/SKILL.md` ([README Development](README.md#development)).
- `gh-axi update` is the SDK built-in, not a local command. `TOP_HELP` in `src/cli.ts` is only a prefix of rendered `--help` ([README Development](README.md#development)).
- `--hostname` comes after the command and wins over `GH_HOST`. Set `GH_HOST` for the child only when the flag is present. `resolveHost()` is the host used when building or parsing URLs ([README Global flags](README.md#global-flags)).
- Secret values never appear in argv, stdout, or error text. `secret set` is stdin-only, rejects `--body`/`-b`, and throws on an interactive TTY instead of waiting. Unknown secret flags are echoed by name only. `secret list` and `variable list` have no `--limit`. Variable values are not secrets ([README Usage](README.md#usage)).
- A malformed or unsupported secret scope is rejected, never silently falls back to repository scope ([README Usage](README.md#usage)).
- Do not pass a `RepoContext` into `ghJson` from `gist` or `project`. `gh project` is owner-scoped: `--owner` defaults to the repo owner, else `@me` ([CONTRIBUTING.md Implementation invariants](CONTRIBUTING.md#implementation-invariants)).
- Every `*_FLAGS` entry must appear in the matching `flags{<sub>}:` help section. Matching is whole-token. `UNDOCUMENTED_ON_PURPOSE` is only for a flag that always fails. Mark a repeatable flag `(repeatable)` in help.
- Repeatable flags must use `getAllFlags` or `takeAllFlags`. `getFlag` and `takeFlag` keep only the first value. Reject a dangling or blank value.
- Mirror `gh`'s mutually exclusive `pr merge` switches locally, on the raw argv, before any `gh` call. Reject `--flag=value` on boolean merge switches the same way.
- `mapGhError` returns on the first matching pattern, so a narrower pattern must sit ahead of a broader one.
- `src/version.ts` imports Node builtins only. Do not add a wall-clock timing assertion to the version fast-path test. Do not rebuild the shared `dist` from an individual suite ([README Development](README.md#development)).
- `stack` is a strict non-interactive adapter over `github/gh-stack`. Preserve stderr and the exact `StackError` exit code. Do not replace `ghRaw` with `ghExec` or `mapGhError`. Stack commands act only on the current working directory repo and never prompt ([CONTRIBUTING.md Implementation invariants](CONTRIBUTING.md#implementation-invariants)).
- `--attach` requires gh >= 2.99.0. Live upload tests use `GH_AXI_TEST_REPO` set to a captain-owned test repo, never a product repo.

## Development

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm test
pnpm run build:skill
```

After a dependency change, run `pnpm exec prettier --write pnpm-lock.yaml`. Do not hand-edit `skills/gh-axi/SKILL.md`, `CHANGELOG.md`, or `.release-please-manifest.json`.

## Release and the contribution gate

[CONTRIBUTING.md](CONTRIBUTING.md) owns the no-mistakes path, release-please, `paths-ignore`, and the pinned `require-no-mistakes` action. Human-authored PRs targeting `main` go through `git push no-mistakes`, not a direct push to `origin`.
The `require-no-mistakes` gate action is pinned to an immutable commit SHA, never `@main` ([CONTRIBUTING.md Release and gate maintenance](CONTRIBUTING.md#release-and-gate-maintenance)).

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
