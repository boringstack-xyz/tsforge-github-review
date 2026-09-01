import { describe, test, expect, mock } from "bun:test";
import { buildLokiPayload, pushToLoki } from "./loki";

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
