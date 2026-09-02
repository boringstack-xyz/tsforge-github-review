import { describe, test, expect, mock } from "bun:test";
import { buildLokiPayload, buildTracePayload, pushToLoki } from "./loki";

describe(buildLokiPayload.name, () => {
  test("builds the exact stream-label shape the dashboard expects", () => {
    const payload = buildLokiPayload({
      repo: "octocat/hello-world",
      outcome: "posted",
      verdict: "needs_changes",
      prNumber: 371,
      prUrl: "https://github.com/octocat/hello-world/pull/371",
      timestampNs: "1234567890000000000",
    });

    expect(payload).toEqual({
      streams: [
        {
          stream: {
            job: "ai-review",
            repo: "octocat/hello-world",
            outcome: "posted",
            trigger: "comment",
            verdict: "needs_changes",
            engine: "tsforge-agentic",
          },
          values: [
            [
              "1234567890000000000",
              JSON.stringify({
                pr_number: 371,
                pr_url: "https://github.com/octocat/hello-world/pull/371",
              }),
            ],
          ],
        },
      ],
    });
  });
});

describe(buildTracePayload.name, () => {
  test("keeps stream labels to job + repo, and injects pr_number into each line", () => {
    const payload = buildTracePayload({
      repo: "octocat/hello-world",
      prNumber: 371,
      lines: ['{"type":"run_started","timestamp":"2026-09-02T10:00:00.000Z"}'],
    });

    expect(payload).toEqual({
      streams: [
        {
          stream: { job: "tsforge-deep-review-trace", repo: "octocat/hello-world" },
          values: [
            [
              "1788343200000000000",
              JSON.stringify({
                type: "run_started",
                timestamp: "2026-09-02T10:00:00.000Z",
                pr_number: 371,
              }),
            ],
          ],
        },
      ],
    });
  });

  test("preserves input order and derives each entry's timestamp from its own event, not a shared push time", () => {
    // Real input (readLatestTraceLog) is already chronological — an
    // append-only JSONL — so this doesn't need to sort, only to use each
    // line's own timestamp rather than one shared push-time for all of them.
    const payload = buildTracePayload({
      repo: "o/r",
      prNumber: 1,
      lines: [
        '{"type":"a","timestamp":"2026-09-02T10:00:01.000Z"}',
        '{"type":"b","timestamp":"2026-09-02T10:00:02.000Z"}',
      ],
    }) as { streams: { values: [string, string][] }[] };

    const [first, second] = payload.streams[0]?.values ?? [];

    expect(first?.[0]).toBe("1788343201000000000");
    expect(second?.[0]).toBe("1788343202000000000");
  });

  test("falls back to push time for a line with no valid timestamp, without dropping it", () => {
    const payload = buildTracePayload({
      repo: "o/r",
      prNumber: 1,
      lines: ["not json"],
    }) as { streams: { values: [string, string][] }[] };

    const [entry] = payload.streams[0]?.values ?? [];

    expect(entry?.[1]).toBe("not json");
    expect(Number(entry?.[0])).toBeGreaterThan(0);
  });
});

describe(pushToLoki.name, () => {
  test("POSTs the payload to <lokiUrl>/loki/api/v1/push", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = mock(async (url: string, init: RequestInit) => {
      calls.push({ url, init });

      return new Response(null, { status: 204 });
    });

    await pushToLoki(
      "http://loki.monitoring.svc.cluster.local:3100",
      { streams: [] },
      fakeFetch as unknown as typeof fetch
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "http://loki.monitoring.svc.cluster.local:3100/loki/api/v1/push"
    );
    expect(calls[0]?.init.method).toBe("POST");
  });

  test("never throws when the push fails (best-effort)", async () => {
    const failingFetch = mock(async () => {
      throw new Error("network unreachable");
    });

    await expect(
      pushToLoki("http://unreachable:3100", { streams: [] }, failingFetch as unknown as typeof fetch)
    ).resolves.toBeUndefined();
  });
});
