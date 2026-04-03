# Changelog

## Unreleased

### Features

- **cli:** add top-level `-v`, `-V`, and `--version` flags

### Bug Fixes

- **cli:** scope repository targeting to command arguments, keep `search --repo`
  working, and rename issue transfer destination flag to `--to-repo`
- **session:** remove the dedicated `--session-start` mode and have installed
  hooks invoke `gh-axi` directly; legacy `--session-start` invocations now act
  as a no-op for backward compatibility
- **errors:** classify mixed-case generic `not found` gh errors as `NOT_FOUND`
  instead of falling back to `UNKNOWN`

## [0.1.10](https://github.com/kunchenguid/gh-axi/compare/gh-axi-v0.1.9...gh-axi-v0.1.10) (2026-04-03)


### Features

* **cli:** add top-level version flags ([#11](https://github.com/kunchenguid/gh-axi/issues/11)) ([a572f3d](https://github.com/kunchenguid/gh-axi/commit/a572f3df0c6c9bc54214983b0459379d5618a6a6))

## [0.1.9](https://github.com/kunchenguid/gh-axi/compare/gh-axi-v0.1.8...gh-axi-v0.1.9) (2026-04-02)


### Bug Fixes

* migrate gh-axi to axi-sdk-js ([#9](https://github.com/kunchenguid/gh-axi/issues/9)) ([137a759](https://github.com/kunchenguid/gh-axi/commit/137a759ba288ce7ac887c35a1710d90d307ea75e))

## [0.1.8](https://github.com/kunchenguid/gh-axi/compare/gh-axi-v0.1.7...gh-axi-v0.1.8) (2026-04-01)


### Bug Fixes

* normalize generic not-found errors ([#7](https://github.com/kunchenguid/gh-axi/issues/7)) ([e9336b9](https://github.com/kunchenguid/gh-axi/commit/e9336b9318c81e034adf354686e88becb77c0e1c))

## [0.1.7](https://github.com/kunchenguid/gh-axi/compare/gh-axi-v0.1.6...gh-axi-v0.1.7) (2026-04-01)

### Features

- initial commit ([0bc360d](https://github.com/kunchenguid/gh-axi/commit/0bc360d09e296dd5ae4c1d7f9b0222d52b798d57))
- **session:** add session start command and hooks ([646deba](https://github.com/kunchenguid/gh-axi/commit/646deba834b21e015c57d144d034234a4410a27b))

### Bug Fixes

- **hooks:** align Codex hook install ([#3](https://github.com/kunchenguid/gh-axi/issues/3)) ([fcb11a3](https://github.com/kunchenguid/gh-axi/commit/fcb11a3920f04f7aa3061e794ab661aa099d715e))

## [0.1.6](https://github.com/kunchenguid/gh-axi/compare/gh-axi-v0.1.5...gh-axi-v0.1.6) (2026-04-01)

### Bug Fixes

- **hooks:** align Codex hook install ([#3](https://github.com/kunchenguid/gh-axi/issues/3)) ([fcb11a3](https://github.com/kunchenguid/gh-axi/commit/fcb11a3920f04f7aa3061e794ab661aa099d715e))

## [0.1.5](https://github.com/kunchenguid/gh-axi/compare/gh-axi-v0.1.4...gh-axi-v0.1.5) (2026-03-29)

### Features

- **session:** add session start command and hooks ([646deba](https://github.com/kunchenguid/gh-axi/commit/646deba834b21e015c57d144d034234a4410a27b))

## [0.1.4](https://github.com/kunchenguid/gh-axi/compare/gh-axi-v0.1.3...gh-axi-v0.1.4) (2026-03-26)

### Features

- initial commit ([0bc360d](https://github.com/kunchenguid/gh-axi/commit/0bc360d09e296dd5ae4c1d7f9b0222d52b798d57))
