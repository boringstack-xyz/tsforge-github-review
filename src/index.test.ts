// src/index.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { optionalEnv, lokiVerdict } from "./index";
import type { IVerifiedFinding } from "./types";

function finding(overrides: Partial<IVerifiedFinding> = {}): IVerifiedFinding {
  return {
    file: "src/a.ts",
    line: 12,
    severity: "error",
    lens: "correctness",
    claim: "off-by-one in the loop bound",
    reason: "index i can reach array.length, throwing on the last iteration",
    verified: true,
    verdict: "confirmed",
    ...overrides,
  };
}

describe(optionalEnv.name, () => {
  const testVarName = "TEST_OPTIONAL_VAR_12345";

  beforeEach(() => {
    delete process.env[testVarName];
  });

  afterEach(() => {
    delete process.env[testVarName];
  });

  test("returns undefined when env var is not set", () => {
    expect(optionalEnv(testVarName)).toBeUndefined();
  });

  test("returns undefined when env var is an empty string", () => {
    process.env[testVarName] = "";
    expect(optionalEnv(testVarName)).toBeUndefined();
  });

  test("returns the value when env var is a non-empty string", () => {
    process.env[testVarName] = "some-value";
    expect(optionalEnv(testVarName)).toBe("some-value");
  });
});

describe(lokiVerdict.name, () => {
  test("returns needs_changes when any finding is error-severity", () => {
    expect(lokiVerdict({ findings: [finding({ severity: "error" })] })).toBe("needs_changes");
  });

  test("returns looks_good when there are no findings at all", () => {
    expect(lokiVerdict({ findings: [] })).toBe("looks_good");
  });

  test("returns looks_good when findings exist but none are error-severity", () => {
    expect(lokiVerdict({ findings: [finding({ severity: "warning" })] })).toBe("looks_good");
  });

  // A reviewer that fails to complete produces a schema-valid report with
  // `findings: []` — without checking failedReviewers, that reads as
  // "looks_good" telemetry for a review that never actually happened.
  test("returns n/a when a reviewer failed to complete, even with no findings", () => {
    expect(lokiVerdict({ findings: [], failedReviewers: ["review"] })).toBe("n/a");
  });

  // failedReviewers takes precedence over the findings-based verdict, same
  // as buildSummaryBody's verdict line — an incomplete review's findings
  // can't be trusted as complete either way.
  test("returns n/a when a reviewer failed to complete, even with error findings", () => {
    expect(
      lokiVerdict({ findings: [finding({ severity: "error" })], failedReviewers: ["review"] })
    ).toBe("n/a");
  });

  test("returns looks_good when failedReviewers is undefined", () => {
    expect(lokiVerdict({ findings: [] })).toBe("looks_good");
  });

  test("returns looks_good when failedReviewers is an empty array", () => {
    expect(lokiVerdict({ findings: [], failedReviewers: [] })).toBe("looks_good");
  });
});
