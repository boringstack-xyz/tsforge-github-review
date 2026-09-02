// src/analyze.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { analyze, FINDINGS_FILE, DIFF_FILE, TRACE_FILE, type IAnalyzeDeps } from "./analyze";
import type { IReviewReport } from "./types";

const REPORT: IReviewReport = { base: "main", changedFiles: ["a.ts"], findings: [], rejected: 0 };

describe(analyze.name, () => {
  const testVarNames = ["INPUT_BASE-REF", "INPUT_MODEL-URL", "INPUT_MODEL-ID", "INPUT_LOKI-URL", "PR_NUMBER"];

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
      readLatestTraceLog: async () => [],
      pushToLoki: async () => undefined,
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

  test("writes no trace file when the trace log is empty", async () => {
    process.env["INPUT_BASE-REF"] = "main";

    const writes: string[] = [];

    await analyze(
      deps({
        writeFile: async (path) => {
          writes.push(path);
        },
      })
    );

    expect(writes).not.toContain(TRACE_FILE);
  });

  test("writes the trace file when the trace log has lines, even with no Loki URL configured", async () => {
    process.env["INPUT_BASE-REF"] = "main";

    const writes: { path: string; contents: string }[] = [];
    let pushed = false;

    await analyze(
      deps({
        readLatestTraceLog: async () => ['{"type":"run_started"}'],
        writeFile: async (path, contents) => {
          writes.push({ path, contents });
        },
        pushToLoki: async () => {
          pushed = true;
        },
      })
    );

    expect(writes).toContainEqual({ path: TRACE_FILE, contents: '{"type":"run_started"}' });
    expect(pushed).toBe(false);
  });

  test("pushes the trace to Loki when a URL and PR number are both available", async () => {
    process.env["INPUT_BASE-REF"] = "main";
    process.env["INPUT_LOKI-URL"] = "http://loki.example";
    process.env.PR_NUMBER = "42";
    process.env.GITHUB_REPOSITORY = "owner/repo";

    let seenUrl: string | undefined;
    let seenPayload: unknown;

    await analyze(
      deps({
        readLatestTraceLog: async () => ['{"type":"run_started"}'],
        pushToLoki: async (url, payload) => {
          seenUrl = url;
          seenPayload = payload;
        },
      })
    );

    expect(seenUrl).toBe("http://loki.example");
    expect(seenPayload).toEqual({
      streams: [
        {
          stream: { job: "tsforge-deep-review-trace", repo: "owner/repo" },
          values: [[expect.any(String), '{"type":"run_started","pr_number":42}']],
        },
      ],
    });

    delete process.env.GITHUB_REPOSITORY;
  });

  test("skips the Loki push when PR_NUMBER is missing, but still writes the trace file", async () => {
    process.env["INPUT_BASE-REF"] = "main";
    process.env["INPUT_LOKI-URL"] = "http://loki.example";

    let pushed = false;
    const writes: string[] = [];

    await analyze(
      deps({
        readLatestTraceLog: async () => ['{"type":"run_started"}'],
        writeFile: async (path) => {
          writes.push(path);
        },
        pushToLoki: async () => {
          pushed = true;
        },
      })
    );

    expect(pushed).toBe(false);
    expect(writes).toContain(TRACE_FILE);
  });

  test("a Loki push failure never fails analyze()", async () => {
    process.env["INPUT_BASE-REF"] = "main";
    process.env["INPUT_LOKI-URL"] = "http://loki.example";
    process.env.PR_NUMBER = "42";
    process.env.GITHUB_REPOSITORY = "owner/repo";

    const result = await analyze(
      deps({
        readLatestTraceLog: async () => ['{"type":"run_started"}'],
        pushToLoki: async () => {
          throw new Error("network down");
        },
      })
    );

    expect(result).toEqual(REPORT);

    delete process.env.GITHUB_REPOSITORY;
  });
});
