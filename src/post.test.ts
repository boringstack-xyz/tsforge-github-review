// src/post.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lokiVerdict, readReport } from "./post";
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

describe(readReport.name, () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "readreport-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("reads and parses a valid IReviewReport file", async () => {
    const path = join(dir, "findings.json");
    const report = { base: "main", changedFiles: ["a.ts"], findings: [], rejected: 0 };
    await writeFile(path, JSON.stringify(report));

    expect(await readReport(path)).toEqual(report);
  });

  // The analyze job and the post job run on different machines (self-hosted
  // pod -> artifact -> possibly a different pod) — a corrupted or
  // schema-mismatched artifact must fail loudly here, not silently post an
  // empty/garbage review.
  test("throws a clear error when the file isn't valid JSON", async () => {
    const path = join(dir, "findings.json");
    await writeFile(path, "not json");

    await expect(readReport(path)).rejects.toThrow("did not contain valid JSON");
  });

  test("throws a clear error when the JSON parses but isn't a report shape", async () => {
    const path = join(dir, "findings.json");
    await writeFile(path, JSON.stringify({ foo: "bar" }));

    await expect(readReport(path)).rejects.toThrow("did not contain a valid IReviewReport");
  });
});
