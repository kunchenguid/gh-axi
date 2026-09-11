import { describe, it, expect } from "vitest";
import {
  getFlag,
  takeBoolFlag,
  takeRequiredFlag,
  getAllFlags,
  takeAllFlags,
  pushRepeated,
  getPositional,
  requireNumber,
  takeNumber,
  rejectUnknownFlags,
} from "../src/args.js";
import { AxiError } from "../src/errors.js";

describe("getFlag", () => {
  it("reads --flag value", () => {
    expect(getFlag(["--state", "opened"], "--state")).toBe("opened");
  });

  it("reads --flag=value", () => {
    expect(getFlag(["--state=opened"], "--state")).toBe("opened");
  });

  it("returns undefined when absent or dangling", () => {
    expect(getFlag([], "--state")).toBeUndefined();
    expect(getFlag(["--state"], "--state")).toBeUndefined();
  });
});

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

describe("getAllFlags / takeAllFlags", () => {
  it("collects every occurrence", () => {
    const args = ["--label", "bug", "--label=backend", "other"];
    expect(getAllFlags(args, "--label")).toEqual(["bug", "backend"]);
    expect(args).toEqual(["--label", "bug", "--label=backend", "other"]);
  });

  it("takeAllFlags removes every occurrence", () => {
    const args = ["--label", "bug", "x", "--label=backend"];
    expect(takeAllFlags(args, "--label")).toEqual(["bug", "backend"]);
    expect(args).toEqual(["x"]);
  });

  it("rejects dangling and blank values instead of dropping them", () => {
    expect(() => getAllFlags(["--label"], "--label")).toThrow(AxiError);
    expect(() => getAllFlags(["--label="], "--label")).toThrow(AxiError);
  });

  it("treats a following option token as a missing value", () => {
    expect(() =>
      getAllFlags(["list", "--label", "--state", "closed"], "--label"),
    ).toThrow(/--label requires a value/);
    const args = ["create", "--assignee", "--label", "bug"];
    expect(() => takeAllFlags(args, "--assignee")).toThrow(
      /--assignee requires a value/,
    );
  });

  it("returns [] when absent", () => {
    expect(getAllFlags(["a"], "--label")).toEqual([]);
  });
});

describe("pushRepeated", () => {
  it("pushes the flag once per value", () => {
    const out = ["mr", "list"];
    pushRepeated(out, "--label", ["bug", "backend"]);
    expect(out).toEqual(["mr", "list", "--label", "bug", "--label", "backend"]);
  });
});

describe("getPositional / requireNumber / takeNumber", () => {
  it("getPositional skips flags", () => {
    expect(getPositional(["view", "--full", "42"], 1)).toBe("42");
    expect(getPositional(["view", "--full"], 1)).toBeUndefined();
  });

  it("requireNumber parses or throws", () => {
    expect(requireNumber("42", "mr")).toBe(42);
    expect(() => requireNumber(undefined, "mr")).toThrow(AxiError);
    expect(() => requireNumber("abc", "mr")).toThrow(AxiError);
  });

  it("takeNumber finds and removes the first numeric positional", () => {
    const args = ["--full", "42"];
    expect(takeNumber(args, "mr")).toBe(42);
    expect(args).toEqual(["--full"]);
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
