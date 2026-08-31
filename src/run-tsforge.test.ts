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
});
