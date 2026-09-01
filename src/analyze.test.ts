// src/analyze.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { analyze, FINDINGS_FILE, DIFF_FILE, type IAnalyzeDeps } from "./analyze";
import type { IReviewReport } from "./types";

const REPORT: IReviewReport = { base: "main", changedFiles: ["a.ts"], findings: [], rejected: 0 };

describe(analyze.name, () => {
  const testVarNames = ["INPUT_BASE-REF", "INPUT_MODEL-URL", "INPUT_MODEL-ID"];

  beforeEach(() => {
    for (const name of testVarNames) delete process.env[name];
  });

  afterEach(() => {
    for (const name of testVarNames) delete process.env[name];
  });

  function deps(overrides: Partial<IAnalyzeDeps> = {}): IAnalyzeDeps {
    return {
      runTsforgeReview: async () => REPORT,
      gitDiff: async () => "diff --git a/a.ts b/a.ts\n",
      writeFile: async () => undefined,
      ...overrides,
    };
  }

  test("throws when INPUT_BASE-REF is missing", async () => {
    await expect(analyze(deps())).rejects.toThrow("missing required input: INPUT_BASE-REF");
  });

  test("runs tsforge with the base ref and writes findings + diff to the expected files", async () => {
    process.env["INPUT_BASE-REF"] = "main";

    const writes: { path: string; contents: string }[] = [];
    const runTsforgeReview = async (opts: { baseRef: string }) => {
      expect(opts.baseRef).toBe("main");

      return REPORT;
    };

    await analyze(
      deps({
        runTsforgeReview,
        writeFile: async (path, contents) => {
          writes.push({ path, contents });
        },
      })
    );

    expect(writes).toEqual([
      { path: FINDINGS_FILE, contents: JSON.stringify(REPORT) },
      { path: DIFF_FILE, contents: "diff --git a/a.ts b/a.ts\n" },
    ]);
  });

  test("passes model-url and model-id through to runTsforgeReview when set", async () => {
    process.env["INPUT_BASE-REF"] = "main";
    process.env["INPUT_MODEL-URL"] = "https://model.example";
    process.env["INPUT_MODEL-ID"] = "some-model";

    let seenOpts: { baseRef: string; modelUrl?: string; modelId?: string } | undefined;

    await analyze(
      deps({
        runTsforgeReview: async (opts) => {
          seenOpts = opts;

          return REPORT;
        },
      })
    );

    expect(seenOpts).toEqual({
      baseRef: "main",
      modelUrl: "https://model.example",
      modelId: "some-model",
    });
  });

  test("returns the report it wrote", async () => {
    process.env["INPUT_BASE-REF"] = "main";

    const result = await analyze(deps());

    expect(result).toEqual(REPORT);
  });
});
