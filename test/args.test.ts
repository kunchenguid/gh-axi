import { describe, it, expect } from "vitest";
import {
  getFlag,
  takeFlag,
  takeRequiredFlag,
  hasFlag,
  takeBoolFlag,
  getAllFlags,
  takeAllFlags,
  pushRepeated,
  getPositional,
  requireNumber,
  rejectUnknownFlags,
} from "../src/args.js";
import { AxiError } from "../src/errors.js";

describe("getFlag", () => {
  it("returns the value following the flag", () => {
    expect(getFlag(["--repo", "cli/cli", "--state", "open"], "--repo")).toBe(
      "cli/cli",
    );
  });

  it("returns the value from --flag=value form", () => {
    expect(getFlag(["--repo=cli/cli", "--state", "open"], "--repo")).toBe(
      "cli/cli",
    );
  });

  it("returns undefined when flag is missing", () => {
    expect(getFlag(["--state", "open"], "--repo")).toBeUndefined();
  });

  it("returns undefined when flag is last element (no value)", () => {
    expect(getFlag(["--state", "open", "--repo"], "--repo")).toBeUndefined();
  });

  it("does not modify the args array", () => {
    const args = ["--repo", "cli/cli"];
    getFlag(args, "--repo");
    expect(args).toEqual(["--repo", "cli/cli"]);
  });
});

describe("takeFlag", () => {
  it("returns value and removes flag+value from args", () => {
    const args = ["--repo", "cli/cli", "--state", "open"];
    const val = takeFlag(args, "--repo");
    expect(val).toBe("cli/cli");
    expect(args).toEqual(["--state", "open"]);
  });

  it("returns value and removes --flag=value from args", () => {
    const args = ["--repo=cli/cli", "--state", "open"];
    const val = takeFlag(args, "--repo");
    expect(val).toBe("cli/cli");
    expect(args).toEqual(["--state", "open"]);
  });

  it("returns undefined when flag is missing", () => {
    const args = ["--state", "open"];
    expect(takeFlag(args, "--repo")).toBeUndefined();
    expect(args).toEqual(["--state", "open"]);
  });

  it("removes flag+value even when value is undefined-ish", () => {
    const args = ["--flag", "val", "--other"];
    // --other is at index 2, takeFlag('--flag') removes indices 0,1
    const val = takeFlag(args, "--flag");
    expect(val).toBe("val");
    expect(args).toEqual(["--other"]);
  });
});

describe("takeRequiredFlag", () => {
  it("returns value and removes flag+value from args", () => {
    const args = ["--source", ".", "--push"];
    expect(takeRequiredFlag(args, "--source")).toBe(".");
    expect(args).toEqual(["--push"]);
  });

  it("returns undefined when flag is absent", () => {
    const args = ["--push"];
    expect(takeRequiredFlag(args, "--source")).toBeUndefined();
    expect(args).toEqual(["--push"]);
  });

  it("throws VALIDATION_ERROR for a dangling flag with no value", () => {
    expect(() => takeRequiredFlag(["--push", "--source"], "--source")).toThrow(
      new AxiError("--source requires a value", "VALIDATION_ERROR"),
    );
  });

  it("throws VALIDATION_ERROR for a blank --flag= value", () => {
    expect(() => takeRequiredFlag(["--source="], "--source")).toThrow(
      new AxiError("--source requires a value", "VALIDATION_ERROR"),
    );
  });

  it("throws VALIDATION_ERROR instead of consuming a following option token as the value", () => {
    const args = ["--source", "--push"];
    expect(() => takeRequiredFlag(args, "--source")).toThrow(
      new AxiError("--source requires a value", "VALIDATION_ERROR"),
    );
    expect(args).toEqual(["--source", "--push"]);
  });

  it("accepts a dash-leading value via the --flag=value form", () => {
    const args = ["--source=-dashy", "--push"];
    expect(takeRequiredFlag(args, "--source")).toBe("-dashy");
    expect(args).toEqual(["--push"]);
  });
});

describe("hasFlag", () => {
  it("returns true when flag is present", () => {
    expect(hasFlag(["--full", "--json"], "--full")).toBe(true);
  });

  it("returns false when flag is absent", () => {
    expect(hasFlag(["--json"], "--full")).toBe(false);
  });

  it("returns false for empty args", () => {
    expect(hasFlag([], "--full")).toBe(false);
  });
});

describe("takeBoolFlag", () => {
  it("returns true and removes flag", () => {
    const args = ["--full", "--json"];
    expect(takeBoolFlag(args, "--full")).toBe(true);
    expect(args).toEqual(["--json"]);
  });

  it("returns false when flag is absent", () => {
    const args = ["--json"];
    expect(takeBoolFlag(args, "--full")).toBe(false);
    expect(args).toEqual(["--json"]);
  });
});

describe("getAllFlags", () => {
  it("collects all values for a repeatable flag", () => {
    const args = [
      "--label",
      "bug",
      "--state",
      "open",
      "--label",
      "help wanted",
    ];
    expect(getAllFlags(args, "--label")).toEqual(["bug", "help wanted"]);
  });

  it("collects repeatable values from --flag=value form", () => {
    const args = ["--label=bug", "--state", "open", "--label=help wanted"];
    expect(getAllFlags(args, "--label")).toEqual(["bug", "help wanted"]);
  });

  it("returns empty array when flag is absent", () => {
    expect(getAllFlags(["--state", "open"], "--label")).toEqual([]);
  });

  it("returns empty array for empty args", () => {
    expect(getAllFlags([], "--label")).toEqual([]);
  });

  it("throws on a dangling flag at end of array with no value", () => {
    const args = ["--label", "bug", "--label"];
    expect(() => getAllFlags(args, "--label")).toThrow(
      "--label requires a value",
    );
  });

  it("leaves args untouched", () => {
    const args = ["--label", "bug", "--state", "open"];
    getAllFlags(args, "--label");
    expect(args).toEqual(["--label", "bug", "--state", "open"]);
  });

  it("throws on an empty --flag= value", () => {
    expect(() => getAllFlags(["--label="], "--label")).toThrow(
      "--label requires a value",
    );
  });

  it("throws on an empty --flag value", () => {
    expect(() =>
      getAllFlags(["--label", "", "--state", "open"], "--label"),
    ).toThrow("--label requires a value");
  });

  it("throws when only one of several occurrences is empty", () => {
    expect(() =>
      getAllFlags(["--label", "bug", "--label="], "--label"),
    ).toThrow(AxiError);
  });
});

describe("takeAllFlags", () => {
  it("collects all values and removes them from args", () => {
    const args = [
      "--label",
      "bug",
      "--state",
      "open",
      "--label",
      "help wanted",
    ];
    expect(takeAllFlags(args, "--label")).toEqual(["bug", "help wanted"]);
    expect(args).toEqual(["--state", "open"]);
  });

  it("removes repeated --flag=value occurrences", () => {
    const args = ["--label=bug", "--state", "open", "--label=help wanted"];
    expect(takeAllFlags(args, "--label")).toEqual(["bug", "help wanted"]);
    expect(args).toEqual(["--state", "open"]);
  });

  it("removes mixed --flag value and --flag=value occurrences", () => {
    const args = ["--label", "bug", "--label=chore", "--state", "open"];
    expect(takeAllFlags(args, "--label")).toEqual(["bug", "chore"]);
    expect(args).toEqual(["--state", "open"]);
  });

  it("returns empty array and leaves args alone when flag is absent", () => {
    const args = ["--state", "open"];
    expect(takeAllFlags(args, "--label")).toEqual([]);
    expect(args).toEqual(["--state", "open"]);
  });

  it("throws on a dangling flag at end of array with no value", () => {
    const args = ["--label", "bug", "--label"];
    expect(() => takeAllFlags(args, "--label")).toThrow(
      "--label requires a value",
    );
  });

  it("throws on an empty value instead of silently dropping it", () => {
    expect(() => takeAllFlags(["--add-label", ""], "--add-label")).toThrow(
      "--add-label requires a value",
    );
  });
});

describe("pushRepeated", () => {
  it("appends the flag once per value", () => {
    const ghArgs = ["issue", "edit", "1"];
    pushRepeated(ghArgs, "--add-label", ["bug", "chore"]);
    expect(ghArgs).toEqual([
      "issue",
      "edit",
      "1",
      "--add-label",
      "bug",
      "--add-label",
      "chore",
    ]);
  });

  it("appends nothing for an empty value list", () => {
    const ghArgs = ["issue", "edit", "1"];
    pushRepeated(ghArgs, "--add-label", []);
    expect(ghArgs).toEqual(["issue", "edit", "1"]);
  });
});

describe("getPositional", () => {
  it("returns first non-flag arg from startIndex", () => {
    expect(getPositional(["view", "42", "--full"], 0)).toBe("view");
  });

  it("skips -- prefixed flags but not their values", () => {
    // getPositional only skips args starting with '--', flag values are treated as positionals
    expect(getPositional(["--state", "open", "42"], 0)).toBe("open");
  });

  it("returns first non-flag token", () => {
    expect(getPositional(["--verbose", "42"], 0)).toBe("42");
  });

  it("returns undefined when all args are flags", () => {
    expect(getPositional(["--state", "--verbose"], 0)).toBeUndefined();
  });

  it("respects startIndex", () => {
    expect(getPositional(["view", "42", "--full"], 1)).toBe("42");
  });

  it("returns undefined for empty args", () => {
    expect(getPositional([], 0)).toBeUndefined();
  });
});

describe("requireNumber", () => {
  it("parses a valid number string", () => {
    expect(requireNumber("42", "issue")).toBe(42);
  });

  it("parses zero", () => {
    expect(requireNumber("0", "issue")).toBe(0);
  });

  it("throws AxiError for undefined input", () => {
    expect(() => requireNumber(undefined, "issue")).toThrow(AxiError);
    expect(() => requireNumber(undefined, "issue")).toThrow(
      "Missing issue number",
    );
  });

  it("throws AxiError for empty string", () => {
    expect(() => requireNumber("", "pr")).toThrow(AxiError);
    expect(() => requireNumber("", "pr")).toThrow("Missing pr number");
  });

  it("throws AxiError for non-numeric string", () => {
    expect(() => requireNumber("abc", "issue")).toThrow(AxiError);
    expect(() => requireNumber("abc", "issue")).toThrow(
      "Invalid issue number: abc",
    );
  });

  it("thrown error has VALIDATION_ERROR code", () => {
    try {
      requireNumber("abc", "issue");
    } catch (e) {
      expect(e).toBeInstanceOf(AxiError);
      expect((e as AxiError).code).toBe("VALIDATION_ERROR");
    }
  });

  describe("rejectUnknownFlags", () => {
    it("passes when no flags are unknown", () => {
      expect(() =>
        rejectUnknownFlags(
          ["--state", "open", "--label", "bug"],
          ["--state", "--label"],
          "issue",
          "list",
        ),
      ).not.toThrow();
    });

    it("passes on positional args", () => {
      expect(() =>
        rejectUnknownFlags(
          ["42", "--comment", "thanks"],
          ["--comment"],
          "issue",
          "comment",
        ),
      ).not.toThrow();
    });

    it("always allows --help and -h", () => {
      expect(() =>
        rejectUnknownFlags(["--help"], [], "issue", "list"),
      ).not.toThrow();
      expect(() => rejectUnknownFlags(["-h"], [], "pr", "list")).not.toThrow();
    });

    it("accepts equals-form known flags", () => {
      expect(() =>
        rejectUnknownFlags(
          ["--state=open", "--limit=5"],
          ["--state", "--limit"],
          "issue",
          "list",
        ),
      ).not.toThrow();
    });

    it("throws listing a single unknown flag with a self-correction hint", () => {
      try {
        rejectUnknownFlags(["--bogus"], ["--state"], "issue", "list");
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(AxiError);
        const err = e as AxiError;
        expect(err.code).toBe("VALIDATION_ERROR");
        expect(err.message).toContain("--bogus");
        expect(err.message).toContain("gh-axi issue list");
        expect(err.suggestions.join("\n")).toContain(
          "gh-axi issue list --help",
        );
      }
    });

    it("lists every unknown flag and dedupes", () => {
      try {
        rejectUnknownFlags(["--one", "--two=2", "--one"], [], "pr", "merge");
        expect.unreachable();
      } catch (e) {
        const err = e as AxiError;
        expect(err.message).toContain("--one");
        expect(err.message).toContain("--two");
        expect(err.message.match(/--one/g)).toHaveLength(1);
      }
    });

    it("does not flag unknown short flags", () => {
      expect(() => rejectUnknownFlags(["-z"], [], "issue", "list")).toThrow(
        AxiError,
      );
    });

    it("stops scanning after a -- separator", () => {
      expect(() =>
        rejectUnknownFlags(["--", "--not-a-flag"], [], "repo", "view"),
      ).not.toThrow();
    });
  });
});
