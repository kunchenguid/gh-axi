import { describe, it, expect } from "vitest";
import {
  takeBoolFlag,
  takeRequiredFlag,
  takeAllFlags,
  pushRepeated,
  onlyPositional,
  rejectPositionals,
  requireNumber,
  rejectUnknownFlags,
} from "../src/args.js";
import { AxiError } from "../src/errors.js";

describe("takeBoolFlag", () => {
  it("takeBoolFlag removes the flag", () => {
    const args = ["view", "1", "--full"];
    expect(takeBoolFlag(args, "--full")).toBe(true);
    expect(args).toEqual(["view", "1"]);
  });

  it("takeBoolFlag matches whole tokens only", () => {
    expect(takeBoolFlag(["--fullest"], "--full")).toBe(false);
  });

  it("rejects a valued spelling instead of dropping it", () => {
    expect(() => takeBoolFlag(["view", "1", "--full=true"], "--full")).toThrow(
      /--full=true/,
    );
  });
});

describe("takeRequiredFlag", () => {
  it("takes a present value", () => {
    const args = ["--title", "Fix login"];
    expect(takeRequiredFlag(args, "--title")).toBe("Fix login");
    expect(args).toEqual([]);
  });

  it("throws on a missing or blank value", () => {
    expect(() => takeRequiredFlag(["--title"], "--title")).toThrow(AxiError);
    expect(() => takeRequiredFlag(["--title="], "--title")).toThrow(AxiError);
    expect(() => takeRequiredFlag(["--title", "  "], "--title")).toThrow(
      AxiError,
    );
  });

  it("treats a following option token as a missing value", () => {
    expect(() =>
      takeRequiredFlag(["--description", "--title", "x"], "--description"),
    ).toThrow(AxiError);
  });

  it("takes a dash-leading value that is not flag-shaped", () => {
    const bullet = ["--description", "- fixes the login redirect"];
    expect(takeRequiredFlag(bullet, "--description")).toBe(
      "- fixes the login redirect",
    );
    expect(takeRequiredFlag(["--title", "-1 regression"], "--title")).toBe(
      "-1 regression",
    );
  });
});

describe("takeAllFlags", () => {
  it("collects and removes every occurrence", () => {
    const args = ["--label", "bug", "x", "--label=backend"];
    expect(takeAllFlags(args, "--label")).toEqual(["bug", "backend"]);
    expect(args).toEqual(["x"]);
  });

  it("rejects dangling and blank values instead of dropping them", () => {
    expect(() => takeAllFlags(["--label"], "--label")).toThrow(AxiError);
    expect(() => takeAllFlags(["--label="], "--label")).toThrow(AxiError);
  });

  it("treats a following option token as a missing value", () => {
    expect(() =>
      takeAllFlags(["list", "--label", "--state", "closed"], "--label"),
    ).toThrow(/--label requires a value/);
  });

  it("returns [] when absent", () => {
    expect(takeAllFlags(["a"], "--label")).toEqual([]);
  });
});

describe("pushRepeated", () => {
  it("pushes the flag once per value", () => {
    const out = ["mr", "list"];
    pushRepeated(out, "--label", ["bug", "backend"]);
    expect(out).toEqual(["mr", "list", "--label", "bug", "--label", "backend"]);
  });
});

describe("onlyPositional / requireNumber", () => {
  it("onlyPositional skips flags", () => {
    expect(onlyPositional(["view", "--full", "42"], 1, "mr")).toBe("42");
    expect(onlyPositional(["view", "--full"], 1, "mr")).toBeUndefined();
  });

  it("onlyPositional rejects a surplus positional", () => {
    expect(() => onlyPositional(["close", "42", "43"], 1, "mr")).toThrow(
      /Too many arguments for mr/,
    );
  });

  it("rejectPositionals refuses a stray token", () => {
    expect(() => rejectPositionals(["list", "closed"], 1, "mr list")).toThrow(
      /Unexpected argument for mr list: closed/,
    );
  });

  it("rejectPositionals passes once the flags have been consumed", () => {
    const args = ["list", "--state", "closed"];
    takeRequiredFlag(args, "--state");
    expect(() => rejectPositionals(args, 1, "mr list")).not.toThrow();
  });

  it("requireNumber parses or throws", () => {
    expect(requireNumber("42", "mr")).toBe(42);
    expect(() => requireNumber(undefined, "mr")).toThrow(AxiError);
    expect(() => requireNumber("abc", "mr")).toThrow(AxiError);
  });

  it("requireNumber rejects trailing garbage instead of truncating it", () => {
    expect(() => requireNumber("42abc", "mr")).toThrow(/Invalid mr number/);
  });
});

describe("rejectUnknownFlags", () => {
  it("passes known flags", () => {
    expect(() =>
      rejectUnknownFlags(["--full", "42"], ["--full"], "mr", "view"),
    ).not.toThrow();
  });

  it("rejects unknown flags with names only (no =value echoed)", () => {
    try {
      rejectUnknownFlags(["--bogus=x"], [], "mr", "view");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AxiError);
      expect((error as AxiError).message).toBe(
        "unknown flag for glab-axi mr view: --bogus",
      );
    }
  });

  it("lists every unknown flag and offers --help", () => {
    try {
      rejectUnknownFlags(["--a", "--b"], [], "mr", "list");
      expect.unreachable();
    } catch (error) {
      expect((error as AxiError).message).toBe(
        "unknown flags for glab-axi mr list: --a, --b",
      );
      expect((error as AxiError).suggestions).toEqual([
        "glab-axi mr list [flags]",
        "glab-axi mr list --help",
      ]);
    }
  });

  it("always passes positionals, --help/-h, and stops at --", () => {
    expect(() =>
      rejectUnknownFlags(["42", "--help", "-h"], [], "mr", "view"),
    ).not.toThrow();
    expect(() =>
      rejectUnknownFlags(["--", "--unknown"], [], "mr", "view"),
    ).not.toThrow();
  });
});
