// src/run-tsforge.test.ts
import { describe, test, expect } from "bun:test";
import { parseTsforgeOutput } from "./run-tsforge";

describe(parseTsforgeOutput.name, () => {
  test("parses valid IReviewReport JSON", () => {
    const stdout = JSON.stringify({
      base: "main",
      changedFiles: ["src/a.ts"],
      findings: [],
      rejected: 0,
    });

    const result = parseTsforgeOutput(stdout);

    expect(result).toEqual({
      base: "main",
      changedFiles: ["src/a.ts"],
      findings: [],
      rejected: 0,
    });
  });

  test("throws a clear error on unparseable output", () => {
    expect(() => parseTsforgeOutput("not json")).toThrow(
      "tsforge review --json did not produce a valid IReviewReport"
    );
  });

  test("throws when the JSON parses but isn't a report shape", () => {
    expect(() => parseTsforgeOutput('{"foo":"bar"}')).toThrow(
      "tsforge review --json did not produce a valid IReviewReport"
    );
  });

  test("parses the report when progress/gate lines precede the JSON on stdout", () => {
    // Real `tsforge review --json` output: human-readable progress lines
    // print first, and the JSON report is only the LAST line of stdout
    // (documented behavior, confirmed against a live run).
    const report = {
      base: "main",
      changedFiles: ["src/a.ts"],
      findings: [],
      rejected: 0,
    };
    const stdout = [
      "agents: fan-out enabled (cap 4)",
      "  ↳ reviewing 1 changed file(s) vs main with 1 reviewer(s)",
      "  ↳ agents: 1/1 done",
      "  ↳ 0 finding(s) after pooling",
      "",
      JSON.stringify(report),
    ].join("\n");

    const result = parseTsforgeOutput(stdout);

    expect(result).toEqual(report);
  });

  test("throws a clear error when the last line isn't JSON even if earlier lines are", () => {
    const stdout = [JSON.stringify({ base: "main", changedFiles: [], findings: [], rejected: 0 }), "trailing text"].join(
      "\n"
    );

    expect(() => parseTsforgeOutput(stdout)).toThrow(
      "tsforge review --json did not produce a valid IReviewReport"
    );
  });
});
