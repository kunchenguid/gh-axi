import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const sourceEntrypoint = join(projectRoot, "bin", "gh-axi.ts");
const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");

let home: string | undefined;

afterEach(() => {
  if (home) {
    rmSync(home, { recursive: true, force: true });
    home = undefined;
  }
});

describe("setup hooks", () => {
  it("installs runnable, portable, idempotent hooks from the source entrypoint", () => {
    home = mkdtempSync(join(tmpdir(), "gh-axi hooks-"));
    const binDir = join(home, "bin");
    createLauncher(binDir);
    const env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
    };
    const runSetup = () =>
      execFileSync(
        process.execPath,
        [tsxCli, sourceEntrypoint, "setup", "hooks"],
        { cwd: projectRoot, encoding: "utf8", env },
      );

    expect(runSetup()).toContain("status: installed");

    const claudeSettingsPath = join(home, ".claude", "settings.json");
    const codexHooksPath = join(home, ".codex", "hooks.json");
    const codexConfigPath = join(home, ".codex", "config.toml");
    const openCodePluginPath = join(
      home,
      ".config",
      "opencode",
      "plugins",
      "axi-gh-axi.js",
    );
    const claudeSettings = JSON.parse(
      readFileSync(claudeSettingsPath, "utf8"),
    ) as {
      hooks: {
        SessionStart: Array<{
          hooks: Array<{ command: string }>;
        }>;
      };
    };
    const command = claudeSettings.hooks.SessionStart[0]?.hooks[0]?.command;

    expect(command).toBe("gh-axi");
    expect(readFileSync(openCodePluginPath, "utf8")).toContain(
      'const command = "gh-axi";',
    );
    expect(runHookCommand(env)).toMatch(/^\d+\.\d+\.\d+\n$/);

    const installedFiles = [
      claudeSettingsPath,
      codexHooksPath,
      codexConfigPath,
      openCodePluginPath,
    ];
    const firstInstallation = installedFiles.map((path) =>
      readFileSync(path, "utf8"),
    );

    expect(runSetup()).toContain("status: installed");
    expect(installedFiles.map((path) => readFileSync(path, "utf8"))).toEqual(
      firstInstallation,
    );
  });
});

function createLauncher(binDir: string): string {
  mkdirSync(binDir, { recursive: true });

  if (process.platform === "win32") {
    const launcher = join(binDir, "gh-axi.cmd");
    writeFileSync(
      launcher,
      `@echo off\r\n"${process.execPath}" "${tsxCli}" "${sourceEntrypoint}" %*\r\n`,
      "utf8",
    );
    return launcher;
  }

  const launcher = join(binDir, "gh-axi");
  writeFileSync(
    launcher,
    `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(tsxCli)} ${shellQuote(sourceEntrypoint)} "$@"\n`,
    "utf8",
  );
  chmodSync(launcher, 0o755);
  return launcher;
}

function runHookCommand(env: NodeJS.ProcessEnv): string {
  if (process.platform === "win32") {
    return execFileSync("cmd.exe", ["/d", "/s", "/c", "gh-axi --version"], {
      encoding: "utf8",
      env,
    });
  }
  return execFileSync("gh-axi", ["--version"], { encoding: "utf8", env });
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
