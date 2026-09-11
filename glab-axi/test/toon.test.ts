import { describe, it, expect } from "vitest";
import {
  field,
  pluck,
  joinArray,
  joinStrings,
  relativeTime,
  boolYesNo,
  lower,
  custom,
  extract,
  renderList,
  renderDetail,
  renderHelp,
  renderError,
  renderOutput,
} from "../src/toon.js";

describe("extract", () => {
  it("field picks a top-level key", () => {
    expect(extract({ iid: 7 }, [field("iid")])).toEqual({ iid: 7 });
  });

  it("field with as renames the output key", () => {
    expect(extract({ web_url: "u" }, [field("web_url", "url")])).toEqual({
      url: "u",
    });
  });

  it("field of a missing key yields null", () => {
    expect(extract({}, [field("iid")])).toEqual({ iid: null });
  });

  it("pluck reaches into a nested object (author.username)", () => {
    expect(
      extract({ author: { username: "alice", id: 1 } }, [
        pluck("author", "username", "author"),
      ]),
    ).toEqual({ author: "alice" });
  });

  it("pluck of a missing parent yields null", () => {
    expect(extract({}, [pluck("author", "username", "author")])).toEqual({
      author: null,
    });
  });

  it("joinArray joins object-array members by subkey", () => {
    expect(
      extract({ assignees: [{ username: "a" }, { username: "b" }] }, [
        joinArray("assignees", "username", "assignees"),
      ]),
    ).toEqual({ assignees: "a,b" });
  });

  it("joinArray uses the empty marker for a missing array", () => {
    expect(extract({}, [joinArray("assignees", "username", "assignees")])).toEqual(
      { assignees: "none" },
    );
  });

  it("joinStrings joins a plain string array (GitLab labels)", () => {
    expect(
      extract({ labels: ["bug", "backend"] }, [joinStrings("labels")]),
    ).toEqual({ labels: "bug,backend" });
  });

  it("joinStrings uses the empty marker for a missing array", () => {
    expect(extract({}, [joinStrings("labels")])).toEqual({ labels: "none" });
  });

  it("relativeTime formats recent and stale timestamps", () => {
    const now = Date.now();
    const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
    expect(relativeTime("created_at", "created") as unknown).toBeDefined();
    const schema = [relativeTime("created_at", "created")];
    expect(extract({ created_at: iso(30_000) }, schema)).toEqual({
      created: "just now",
    });
    expect(extract({ created_at: iso(2 * 60 * 60 * 1000) }, schema)).toEqual({
      created: "2h ago",
    });
    expect(extract({ created_at: iso(3 * 24 * 60 * 60 * 1000) }, schema)).toEqual(
      { created: "3d ago" },
    );
  });

  it("relativeTime of a missing value is unknown", () => {
    expect(extract({}, [relativeTime("created_at", "created")])).toEqual({
      created: "unknown",
    });
  });

  it("boolYesNo maps booleans", () => {
    expect(extract({ draft: true }, [boolYesNo("draft", "draft")])).toEqual({
      draft: "yes",
    });
    expect(extract({ draft: false }, [boolYesNo("draft", "draft")])).toEqual({
      draft: "no",
    });
  });

  it("lower lowercases string values only", () => {
    expect(extract({ state: "Opened" }, [lower("state")])).toEqual({
      state: "opened",
    });
    expect(extract({ state: null }, [lower("state")])).toEqual({ state: null });
  });

  it("custom applies a function", () => {
    expect(
      extract({ a: 2, b: 3 }, [custom("sum", (i) => i.a + i.b)]),
    ).toEqual({ sum: 5 });
  });
});

describe("renderList / renderDetail", () => {
  const schema = [field("iid"), lower("state")];

  it("renderList emits a TOON list under the label", () => {
    const out = renderList(
      "mrs",
      [
        { iid: 1, state: "opened" },
        { iid: 2, state: "merged" },
      ],
      schema,
    );
    expect(out).toContain("mrs[2]{iid,state}:");
    expect(out).toContain("1,opened");
    expect(out).toContain("2,merged");
  });

  it("renderDetail emits a TOON object under the label", () => {
    const out = renderDetail("mr", { iid: 3, state: "closed" }, schema);
    expect(out).toContain("mr:");
    expect(out).toContain("iid: 3");
    expect(out).toContain("state: closed");
  });
});

describe("renderHelp", () => {
  it("renders an empty string for no lines", () => {
    expect(renderHelp([])).toBe("");
  });

  it("counts lines in the header and indents each", () => {
    const out = renderHelp(["a", "b"]);
    expect(out).toBe("help[2]:\n  a\n  b");
  });
});

describe("renderError", () => {
  it("renders error and code, plus help when suggestions exist", () => {
    const out = renderError("boom", "VALIDATION_ERROR", ["try x"]);
    expect(out).toContain("error: boom");
    expect(out).toContain("code: VALIDATION_ERROR");
    expect(out).toContain("help[1]:");
  });

  it("omits the help block without suggestions", () => {
    const out = renderError("boom", "UNKNOWN");
    expect(out).toContain("error: boom");
    expect(out).not.toContain("help[");
  });
});

describe("renderOutput", () => {
  it("joins blocks with newlines and drops empty ones", () => {
    expect(renderOutput(["a", "", "b"])).toBe("a\nb");
  });
});
