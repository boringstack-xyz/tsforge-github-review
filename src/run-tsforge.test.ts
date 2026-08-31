// src/run-tsforge.test.ts
import { describe, test, expect } from "bun:test";
import { parseTsforgeOutput, buildTsforgeEnv } from "./run-tsforge";

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

  // Finding 6 (final whole-branch review): the error must carry enough of
  // the raw stdout to debug a real CI failure without re-running it.
  test("includes an excerpt of stdout when it's unparseable", () => {
    const stdout = "totally not json, from a broken tsforge run";

    expect(() => parseTsforgeOutput(stdout)).toThrow(stdout);
  });

  test("includes an excerpt of stdout when the JSON parses but isn't a report shape", () => {
    const stdout = '{"foo":"bar"}';

    expect(() => parseTsforgeOutput(stdout)).toThrow(stdout);
  });

  test("truncates a long stdout excerpt to the trailing ~200 characters", () => {
    const stdout = "x".repeat(500);

    let thrown: unknown;

    try {
      parseTsforgeOutput(stdout);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;

    // The excerpt is bounded, not the whole 500-char stdout.
    expect(message.length).toBeLessThan(stdout.length);
    expect(message).toContain("...");
    expect(message).toContain("x".repeat(200));
  });
});

describe(buildTsforgeEnv.name, () => {
  // Finding 4 (final whole-branch review): `tsforge review` is agentic and
  // runs against untrusted PR content — it must never see a write-scoped
  // GitHub token.
  test("strips INPUT_GITHUB-TOKEN from the built env", () => {
    const env = buildTsforgeEnv(
      { baseRef: "main" },
      { "INPUT_GITHUB-TOKEN": "secret-token", OTHER_VAR: "kept" }
    );

    expect(env["INPUT_GITHUB-TOKEN"]).toBeUndefined();
    expect(env.OTHER_VAR).toBe("kept");
  });

  test("strips GITHUB_TOKEN from the built env, in case the calling workflow also set it", () => {
    const env = buildTsforgeEnv({ baseRef: "main" }, { GITHUB_TOKEN: "also-secret", OTHER_VAR: "kept" });

    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.OTHER_VAR).toBe("kept");
  });

  test("strips both token vars at once, leaving unrelated vars untouched", () => {
    const env = buildTsforgeEnv(
      { baseRef: "main" },
      { "INPUT_GITHUB-TOKEN": "a", GITHUB_TOKEN: "b", PATH: "/usr/bin" }
    );

    expect(env["INPUT_GITHUB-TOKEN"]).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
  });

  test("sets TSFORGE_BASE_URL and TSFORGE_MODEL when provided", () => {
    const env = buildTsforgeEnv({ baseRef: "main", modelUrl: "https://model", modelId: "gpt-x" }, {});

    expect(env.TSFORGE_BASE_URL).toBe("https://model");
    expect(env.TSFORGE_MODEL).toBe("gpt-x");
  });

  test("omits TSFORGE_BASE_URL / TSFORGE_MODEL when not provided", () => {
    const env = buildTsforgeEnv({ baseRef: "main" }, {});

    expect(env.TSFORGE_BASE_URL).toBeUndefined();
    expect(env.TSFORGE_MODEL).toBeUndefined();
  });
});
