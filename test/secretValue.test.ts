import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../src/stdin.js", () => ({
  readStdin: vi.fn(),
  isStdinTTY: vi.fn(),
}));

import { readStdin, isStdinTTY } from "../src/stdin.js";
import { resolveValue } from "../src/secretValue.js";
import { AxiError } from "../src/errors.js";

const mockedReadStdin = vi.mocked(readStdin);
const mockedIsStdinTTY = vi.mocked(isStdinTTY);

describe("resolveValue", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns the variable flag value without touching stdin when provided", async () => {
    const value = await resolveValue("production", "variable");
    expect(value).toBe("production");
    expect(mockedReadStdin).not.toHaveBeenCalled();
    expect(mockedIsStdinTTY).not.toHaveBeenCalled();
  });

  it("throws when the flag value is empty", async () => {
    await expect(resolveValue("", "variable")).rejects.toThrow(AxiError);
  });

  it("rejects secret flag values", async () => {
    await expect(resolveValue("sk-flag-value", "secret")).rejects.toThrow(
      "--body/-b is not accepted",
    );
    expect(mockedReadStdin).not.toHaveBeenCalled();
    expect(mockedIsStdinTTY).not.toHaveBeenCalled();
  });

  it("reads from stdin when no flag value is given and stdin is piped", async () => {
    mockedIsStdinTTY.mockReturnValue(false);
    mockedReadStdin.mockResolvedValue("piped-value");

    const value = await resolveValue(undefined, "variable");

    expect(value).toBe("piped-value");
    expect(mockedReadStdin).toHaveBeenCalledTimes(1);
  });

  it("throws instead of blocking when stdin is an interactive TTY", async () => {
    mockedIsStdinTTY.mockReturnValue(true);

    await expect(resolveValue(undefined, "secret")).rejects.toThrow(AxiError);
    expect(mockedReadStdin).not.toHaveBeenCalled();
  });

  it("does not suggest secret flags when secret stdin is missing", async () => {
    mockedIsStdinTTY.mockReturnValue(true);

    await expect(resolveValue(undefined, "secret")).rejects.toThrow(
      "pipe the value via stdin",
    );
    await expect(resolveValue(undefined, "secret")).rejects.not.toThrow(
      "--body",
    );
  });

  it("keeps variable flag guidance when variable stdin is missing", async () => {
    mockedIsStdinTTY.mockReturnValue(true);

    await expect(resolveValue(undefined, "variable")).rejects.toThrow(
      "--body <value>",
    );
  });

  it("throws when piped stdin is empty", async () => {
    mockedIsStdinTTY.mockReturnValue(false);
    mockedReadStdin.mockResolvedValue("");

    await expect(resolveValue(undefined, "secret")).rejects.toThrow(AxiError);
  });
});
