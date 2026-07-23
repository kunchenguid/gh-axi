# Changelog

## Unreleased

### Features

- **cli:** add top-level `-v`, `-V`, and `--version` flags

### Bug Fixes

- **cli:** scope repository targeting to command arguments, keep `search --repo`
  working, and rename issue transfer destination flag to `--to-repo`
- **run:** allow `run view --job <job-id>` without a run id, include job steps in
  job view output, and support job-scoped `--log` and `--log-failed`
- **session:** remove the dedicated `--session-start` mode and have installed
  hooks invoke `gh-axi` directly; legacy `--session-start` invocations now act
  as a no-op for backward compatibility
- **errors:** classify mixed-case generic `not found` gh errors as `NOT_FOUND`
  instead of falling back to `UNKNOWN`

## [0.1.28](https://github.com/kunchenguid/gh-axi/compare/gh-axi-v0.1.27...gh-axi-v0.1.28) (2026-07-23)


### Bug Fixes

* **commands:** apply every repeated label, assignee, reviewer and project flag ([#78](https://github.com/kunchenguid/gh-axi/issues/78)) ([2a6f6f4](https://github.com/kunchenguid/gh-axi/commit/2a6f6f45335ef4214db98e16338f274e790047e2))
* **commands:** count filtered issue and pr lists through search ([#79](https://github.com/kunchenguid/gh-axi/issues/79)) ([6e1dcf4](https://github.com/kunchenguid/gh-axi/commit/6e1dcf4dda91c18111f18475e071a8b8a0dd2977))
* **commands:** stop api from silently dropping --jq and unknown flags ([#81](https://github.com/kunchenguid/gh-axi/issues/81)) ([dc52d29](https://github.com/kunchenguid/gh-axi/commit/dc52d2938f46833d2663ba0313f7ef22fe4b3933))
* execute every PR body compliance event ([#82](https://github.com/kunchenguid/gh-axi/issues/82)) ([b8b4f3b](https://github.com/kunchenguid/gh-axi/commit/b8b4f3bc2497a81e3e50076a91b11a9e88de0c7e))
* **pr:** classify legacy commit statuses and red check runs correctly ([#71](https://github.com/kunchenguid/gh-axi/issues/71)) ([291fc1a](https://github.com/kunchenguid/gh-axi/commit/291fc1af90005f3c9b10b1ae2f640c2ed2d46abb))

## [0.1.27](https://github.com/kunchenguid/gh-axi/compare/gh-axi-v0.1.26...gh-axi-v0.1.27) (2026-07-12)


### Features

* **commands:** support environment-scoped secrets ([#70](https://github.com/kunchenguid/gh-axi/issues/70)) ([ed8ae84](https://github.com/kunchenguid/gh-axi/commit/ed8ae84bf3b138502e23421047b7cc08248c062c))


### Bug Fixes

* **repo:** honor positional repo view targets ([#66](https://github.com/kunchenguid/gh-axi/issues/66)) ([b1092e2](https://github.com/kunchenguid/gh-axi/commit/b1092e22d986a8acab2d861905f96daab000e6ff))

## [0.1.26](https://github.com/kunchenguid/gh-axi/compare/gh-axi-v0.1.25...gh-axi-v0.1.26) (2026-07-08)


### Features

* **cli:** support GitHub Enterprise hosts ([#63](https://github.com/kunchenguid/gh-axi/issues/63)) ([2236646](https://github.com/kunchenguid/gh-axi/commit/2236646523af56d938b7a1fa1cb5b499aff33e57))
* **commands:** add GitHub Projects support ([#67](https://github.com/kunchenguid/gh-axi/issues/67)) ([39156c8](https://github.com/kunchenguid/gh-axi/commit/39156c8d88c3ec284e3c8ea2b2178b3c5cdc3274))


### Bug Fixes

* **suggestions:** place -R after command in repo-qualified hints ([#60](https://github.com/kunchenguid/gh-axi/issues/60)) ([de3b6f5](https://github.com/kunchenguid/gh-axi/commit/de3b6f5b779f2fc5cd88b31d6e0623a60642f4c6))

## [0.1.25](https://github.com/kunchenguid/gh-axi/compare/gh-axi-v0.1.24...gh-axi-v0.1.25) (2026-07-01)


### Features

* **commands:** add secret and variable commands ([#59](https://github.com/kunchenguid/gh-axi/issues/59)) ([e3d00d8](https://github.com/kunchenguid/gh-axi/commit/e3d00d83b8b16106d81be5de1ed804028cb73622))


### Bug Fixes

* **commands:** apply all repeated --label flags on issue and pr create ([#57](https://github.com/kunchenguid/gh-axi/issues/57)) ([0d75865](https://github.com/kunchenguid/gh-axi/commit/0d758656d00c07651cf199eef18ffc1bb5ca9281))

## [0.1.24](https://github.com/kunchenguid/gh-axi/compare/gh-axi-v0.1.23...gh-axi-v0.1.24) (2026-06-27)


### Bug Fixes

* **run:** cross-reference workflow dispatch command ([#53](https://github.com/kunchenguid/gh-axi/issues/53)) ([2a775c6](https://github.com/kunchenguid/gh-axi/commit/2a775c693c2154848db6c55cc97c0726a866467e))

## [0.1.23](https://github.com/kunchenguid/gh-axi/compare/gh-axi-v0.1.22...gh-axi-v0.1.23) (2026-06-27)


### Features

* inherit SDK self-update command ([#51](https://github.com/kunchenguid/gh-axi/issues/51)) ([327c329](https://github.com/kunchenguid/gh-axi/commit/327c3294fae2bac2632580a3920688505156a449))

## [0.1.22](https://github.com/kunchenguid/gh-axi/compare/gh-axi-v0.1.21...gh-axi-v0.1.22) (2026-06-21)


### Features

* **commands:** add body-file support for markdown bodies ([#47](https://github.com/kunchenguid/gh-axi/issues/47)) ([9192ce6](https://github.com/kunchenguid/gh-axi/commit/9192ce60be6ca7cb928bb92fbbedd35dab77a503))

## [0.1.21](https://github.com/kunchenguid/gh-axi/compare/gh-axi-v0.1.20...gh-axi-v0.1.21) (2026-06-17)


### Features

* **skills:** add Hermes metadata to gh-axi skill ([#43](https://github.com/kunchenguid/gh-axi/issues/43)) ([f703922](https://github.com/kunchenguid/gh-axi/commit/f703922b7257b67eb15d5024a21e4100fb430ba8))


### Bug Fixes

* hide vendored no-mistakes skill from discovery ([#41](https://github.com/kunchenguid/gh-axi/issues/41)) ([1603e94](https://github.com/kunchenguid/gh-axi/commit/1603e941367cfad17cad933f12b630a827192a3d))
* preserve gh argument forwarding ([#46](https://github.com/kunchenguid/gh-axi/issues/46)) ([9b1abda](https://github.com/kunchenguid/gh-axi/commit/9b1abda2ced148d0eccb6dafdc30339cf8e58a8c))

## [0.1.20](https://github.com/kunchenguid/gh-axi/compare/gh-axi-v0.1.19...gh-axi-v0.1.20) (2026-06-11)


### Features

* add installable agent skill ([#38](https://github.com/kunchenguid/gh-axi/issues/38)) ([c98b2fa](https://github.com/kunchenguid/gh-axi/commit/c98b2fa400ddd25e4f828f9e2d102b990ceb98c3))


### Bug Fixes

* **commands:** preserve run log tails when truncating ([#40](https://github.com/kunchenguid/gh-axi/issues/40)) ([4531c7c](https://github.com/kunchenguid/gh-axi/commit/4531c7cf4d1b52763ed4fe2039848c52d100f7f6))

## [0.1.19](https://github.com/kunchenguid/gh-axi/compare/gh-axi-v0.1.18...gh-axi-v0.1.19) (2026-05-23)


### Features

* **commands:** add explicit hook setup ([#35](https://github.com/kunchenguid/gh-axi/issues/35)) ([3237b79](https://github.com/kunchenguid/gh-axi/commit/3237b79c07f59ac4927ce8d82ef1c3e32fa0ea14))

## [0.1.18](https://github.com/kunchenguid/gh-axi/compare/gh-axi-v0.1.17...gh-axi-v0.1.18) (2026-05-13)


### Features

* **commands:** add issue subissue management ([#34](https://github.com/kunchenguid/gh-axi/issues/34)) ([e640259](https://github.com/kunchenguid/gh-axi/commit/e640259f3c167f448ee7df803aa5e79605580946))
* **issue:** support GitHub issue types ([#32](https://github.com/kunchenguid/gh-axi/issues/32)) ([58db24f](https://github.com/kunchenguid/gh-axi/commit/58db24f09f6c5c650c16f46ca097672452bbb4f2))

## [0.1.17](https://github.com/kunchenguid/gh-axi/compare/gh-axi-v0.1.16...gh-axi-v0.1.17) (2026-05-13)


### Bug Fixes

* **deps:** upgrade axi-sdk-js ([a265622](https://github.com/kunchenguid/gh-axi/commit/a26562293f27d5058bd5a83fe2f6bdbea7a47330))

## [0.1.16](https://github.com/kunchenguid/gh-axi/compare/gh-axi-v0.1.15...gh-axi-v0.1.16) (2026-05-10)


### Features

* **errors:** map GitHub rate-limit stderr to RATE_LIMITED code ([#25](https://github.com/kunchenguid/gh-axi/issues/25)) ([869ff03](https://github.com/kunchenguid/gh-axi/commit/869ff03c3df8ab2ab99b4141c1e3d8356e683e6f))

## [0.1.15](https://github.com/kunchenguid/gh-axi/compare/gh-axi-v0.1.14...gh-axi-v0.1.15) (2026-05-03)


### Bug Fixes

* make search query optional when filter flags are provided ([#22](https://github.com/kunchenguid/gh-axi/issues/22)) ([7fe9aed](https://github.com/kunchenguid/gh-axi/commit/7fe9aed01fca936266e28f3bc4c8e56c89f4e36f))

## [0.1.14](https://github.com/kunchenguid/gh-axi/compare/gh-axi-v0.1.13...gh-axi-v0.1.14) (2026-04-30)


### Bug Fixes

* **commands:** render PR reviews with inline comments ([#20](https://github.com/kunchenguid/gh-axi/issues/20)) ([2952cf8](https://github.com/kunchenguid/gh-axi/commit/2952cf8ab7b83f7df8fdf3084db4bd88d9f05cb8))

## [0.1.13](https://github.com/kunchenguid/gh-axi/compare/gh-axi-v0.1.12...gh-axi-v0.1.13) (2026-04-25)


### Miscellaneous Chores

* release 0.1.13 ([e78ecea](https://github.com/kunchenguid/gh-axi/commit/e78ecea3a068febe2cd5a2e17b3532e9294fc63e))

## [0.1.12](https://github.com/kunchenguid/gh-axi/compare/gh-axi-v0.1.11...gh-axi-v0.1.12) (2026-04-14)


### Bug Fixes

* **run:** harden job-level run view behavior ([#15](https://github.com/kunchenguid/gh-axi/issues/15)) ([162cc3a](https://github.com/kunchenguid/gh-axi/commit/162cc3a12364fce4a0fa5d89a5b7267325502917))

## [0.1.11](https://github.com/kunchenguid/gh-axi/compare/gh-axi-v0.1.10...gh-axi-v0.1.11) (2026-04-09)

### Features

- **pr:** add --full flag to diff and improve truncation ([677da2b](https://github.com/kunchenguid/gh-axi/commit/677da2b984ed51dde4cd1493357774c9a59f0768))

## [0.1.10](https://github.com/kunchenguid/gh-axi/compare/gh-axi-v0.1.9...gh-axi-v0.1.10) (2026-04-03)

### Features

- **cli:** add top-level version flags ([#11](https://github.com/kunchenguid/gh-axi/issues/11)) ([a572f3d](https://github.com/kunchenguid/gh-axi/commit/a572f3df0c6c9bc54214983b0459379d5618a6a6))

## [0.1.9](https://github.com/kunchenguid/gh-axi/compare/gh-axi-v0.1.8...gh-axi-v0.1.9) (2026-04-02)

### Bug Fixes

- migrate gh-axi to axi-sdk-js ([#9](https://github.com/kunchenguid/gh-axi/issues/9)) ([137a759](https://github.com/kunchenguid/gh-axi/commit/137a759ba288ce7ac887c35a1710d90d307ea75e))

## [0.1.8](https://github.com/kunchenguid/gh-axi/compare/gh-axi-v0.1.7...gh-axi-v0.1.8) (2026-04-01)

### Bug Fixes

- normalize generic not-found errors ([#7](https://github.com/kunchenguid/gh-axi/issues/7)) ([e9336b9](https://github.com/kunchenguid/gh-axi/commit/e9336b9318c81e034adf354686e88becb77c0e1c))

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
