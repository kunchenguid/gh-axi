# gh-axi version fast-path evidence

Built entrypoint exercised with Node 24.13.1.

## End-user flag parity

The public CLI was spawned once for each supported standalone version flag. JSON encoding makes the trailing newline and empty stderr explicit.

```json
{"args":["-v"],"status":0,"stdout":"0.1.29\n","stderr":""}
{"args":["-V"],"status":0,"stdout":"0.1.29\n","stderr":""}
{"args":["--version"],"status":0,"stdout":"0.1.29\n","stderr":""}
```

## Runtime module trace

The built entrypoint was run under the repository's `module.register()` trace hook. The standalone version path loads the version leaf and SDK fast path without loading the CLI graph, command modules, or TOON dependency. The help path is the negative control and loads the heavy graph normally.

```json
{"path":"--version","status":0,"versionLeafLoaded":true,"fastPathLoaded":true,"cliGraphLoaded":false,"commandModulesLoaded":0,"toonLoaded":false}
{"path":"--help","status":0,"versionLeafLoaded":true,"fastPathLoaded":true,"cliGraphLoaded":true,"commandModulesLoaded":15,"toonLoaded":true}
```

## Conservative fallback

A version flag outside the exact one-argument fast-path shape reaches the normal CLI graph:

```json
{"args":["issue","--version"],"status":0,"stdout":"error: \"Unknown issue subcommand: --version\"\ncode: VALIDATION_ERROR\nhelp[1]:\n  Run `gh-axi issue --help` for usage\n","stderr":"","cliGraphLoaded":true,"commandModulesLoaded":15}
```

The top-level `--help` invocation also exited 0 and rendered the normal usage, 15-command list, flags, examples, and SDK-provided built-in update section.
