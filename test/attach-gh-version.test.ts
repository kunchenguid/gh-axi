import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  ATTACH_MIN_GH,
  attachSkipReason,
  resolveTestGh,
  versionAtLeast,
} from "./helpers/gh-bin.js";

const resolved = resolveTestGh();
const ok =
  resolved !== undefined && versionAtLeast(resolved.version, ATTACH_MIN_GH);
const skipReason = attachSkipReason(resolved);

describe("gh --attach availability", () => {
  it.skipIf(!ok)(
    ok
      ? `resolved gh ${resolved?.version} at ${resolved?.path} is >= ${ATTACH_MIN_GH}`
      : skipReason,
    () => {
      if (!ok || !resolved) {
        throw new Error(skipReason);
      }
      const help = execFileSync(resolved.path, ["issue", "create", "--help"], {
        encoding: "utf8",
      });
      expect(help).toMatch(/--attach/);
      expect(help).toContain("--attach ./before.png --attach ./after.png");
    },
  );
});
