# Vision

`gh-axi` is an agent-ergonomic interface to the official GitHub CLI, `gh`.

## Scope

We aim for full functional parity with `gh`.
Every capability available through `gh` should eventually be accessible through an AXI-native interface.

We accept contributions that expose existing `gh` capabilities more ergonomically.
We do not add GitHub functionality that cannot be provided through `gh`.

## Interface

The interface must follow validated AXI principles and optimize for autonomous agent use.

Output may be structured, but its structure exists for agent comprehension rather than as a stable API for imperative programs.
Human-oriented presentation and compatibility work primarily serving hand-written parsers are not goals.

The wrapper may reshape, combine, or simplify `gh` operations when doing so improves agent ergonomics without expanding the underlying capability.
