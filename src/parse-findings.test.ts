import { describe, test, expect } from "bun:test";
import { buildReviewComments, buildSummaryBody } from "./parse-findings";
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

describe(buildReviewComments.name, () => {
  test("maps an in-diff finding to a comment with claim + reason in the body", () => {
    const lines = new Map([["src/a.ts", new Set([12])]]);
    const { comments, outOfDiff } = buildReviewComments([finding()], lines);

    expect(comments).toEqual([
      {
        path: "src/a.ts",
        line: 12,
        body: "**[correctness]** off-by-one in the loop bound\n\noff-by-one in the loop bound: index i can reach array.length, throwing on the last iteration",
      },
    ]);
    expect(outOfDiff).toEqual([]);
  });

  test("routes an out-of-diff finding to outOfDiff instead of comments", () => {
    const lines = new Map([["src/a.ts", new Set([5])]]); // finding is on line 12, not in the set
    const { comments, outOfDiff } = buildReviewComments([finding()], lines);

    expect(comments).toEqual([]);
    expect(outOfDiff).toEqual([finding()]);
  });

  test("routes a finding in an unseen file to outOfDiff", () => {
    const { comments, outOfDiff } = buildReviewComments([finding()], new Map());

    expect(comments).toEqual([]);
    expect(outOfDiff).toEqual([finding()]);
  });

  test("appends the suggested fix when present", () => {
    const lines = new Map([["src/a.ts", new Set([12])]]);
    const withFix = finding({ suggestedFix: "use `i < array.length` instead of `<=`" });
    const { comments } = buildReviewComments([withFix], lines);

    expect(comments[0]?.body).toContain(
      "\n\nSuggested fix: use `i < array.length` instead of `<=`"
    );
  });
});

describe(buildSummaryBody.name, () => {
  test("says Needs changes when any finding is error-severity", () => {
    const body = buildSummaryBody([finding({ severity: "error" })], []);

    expect(body).toStartWith("⚠️ Needs changes");
  });

  test("says Looks good when there are no findings at all", () => {
    expect(buildSummaryBody([], [])).toStartWith("✅ Looks good");
  });

  test("says Looks good when findings exist but none are error-severity", () => {
    const body = buildSummaryBody([finding({ severity: "warning" })], []);

    expect(body).toStartWith("✅ Looks good");
  });

  test("lists out-of-diff findings by file:line so they aren't silently dropped", () => {
    const body = buildSummaryBody([], [finding({ file: "src/b.ts", line: 99 })]);

    expect(body).toContain("src/b.ts:99");
    expect(body).toContain("off-by-one in the loop bound");
  });

  // Confirmed live against tsforge PR #358: a reviewer that hits `max_turns`
  // still returns a schema-valid report with `findings: []` and
  // `failedReviewers: ["review"]`. Without surfacing that, an incomplete
  // review reads as a clean "✅ Looks good".
  test("flags an incomplete review even when findings is empty", () => {
    const body = buildSummaryBody([], [], ["review"]);

    expect(body).toStartWith("❔ Incomplete review");
    expect(body).toContain("1 reviewer(s) did not complete (review)");
  });

  test("does not add a failure note when no reviewers failed", () => {
    const body = buildSummaryBody([], []);

    expect(body).not.toContain("did not complete");
  });

  // The verdict line itself (not just the note beneath it) must be honest:
  // "✅ Looks good" and "⚠️ Needs changes" both imply the review reached a
  // real judgment, which it didn't if a reviewer failed to complete.
  test("uses the Incomplete review verdict, not Looks good, when a reviewer failed and findings is empty", () => {
    const body = buildSummaryBody([], [], ["review"]);

    expect(body).toStartWith("❔ Incomplete review");
    expect(body).not.toStartWith("✅ Looks good");
  });

  // failedReviewers takes precedence over the findings-based verdict even
  // when findings happen to be non-empty — an incomplete review's findings
  // can't be trusted as complete either way.
  test("uses the Incomplete review verdict even when findings is non-empty", () => {
    const body = buildSummaryBody([finding({ severity: "error" })], [], ["review"]);

    expect(body).toStartWith("❔ Incomplete review");
    expect(body).not.toStartWith("⚠️ Needs changes");
  });

  test("combines the Incomplete review verdict, a failure note, and out-of-diff findings", () => {
    const body = buildSummaryBody(
      [finding({ severity: "error" })],
      [finding({ file: "src/b.ts", line: 99 })],
      ["review"]
    );

    expect(body).toStartWith("❔ Incomplete review");
    expect(body).toContain("1 reviewer(s) did not complete (review)");
    expect(body).toContain("src/b.ts:99");
  });
});
