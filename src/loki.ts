export interface ILokiPayloadOpts {
  repo: string;
  outcome: "posted" | "error";
  verdict: "looks_good" | "needs_changes" | "n/a";
  prNumber: number;
  prUrl: string;
  timestampNs: string;
}

/** The exact stream-label shape the existing diff-only reviewer already
 *  pushes (job/repo/outcome/trigger/verdict), plus one new label
 *  (engine=tsforge-agentic) so the Grafana dashboard can tell the two
 *  reviewers apart. trigger is always "comment" — this reviewer only ever
 *  runs on a /deep-review comment, never a push. */
export function buildLokiPayload(opts: ILokiPayloadOpts): unknown {
  return {
    streams: [
      {
        stream: {
          job: "ai-review",
          repo: opts.repo,
          outcome: opts.outcome,
          trigger: "comment",
          verdict: opts.verdict,
          engine: "tsforge-agentic",
        },
        values: [
          [
            opts.timestampNs,
            JSON.stringify({ pr_number: opts.prNumber, pr_url: opts.prUrl }),
          ],
        ],
      },
    ],
  };
}

/** Best-effort — a Loki push failure must never fail the action, matching
 *  the existing reviewer's `curl ... || true` convention. */
export async function pushToLoki(
  lokiUrl: string,
  payload: unknown,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  try {
    await fetchImpl(`${lokiUrl}/loki/api/v1/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // Best-effort. Nothing to do here.
  }
}
