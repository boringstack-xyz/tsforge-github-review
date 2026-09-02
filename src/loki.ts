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

export interface ITracePayloadOpts {
  repo: string;
  prNumber: number;
  /** Raw JSONL lines from `tsforge review --log` — one tsforge ledger event
   *  per line, already redacted and size-capped by tsforge itself. */
  lines: readonly string[];
}

/** One Loki entry per ledger event, timestamped from the event's own
 *  `timestamp` (not push time) so it lines up with when it actually
 *  happened. Labels stay low-cardinality (job + repo) — everything else
 *  (event type, tool, turn, agentId, ...) stays in the JSON line body,
 *  queryable via LogQL's `| json` without a new Loki stream per PR.
 *  `pr_number` is injected into each line (rather than a label, same
 *  cardinality reason) so a query can still scope to one PR. */
export function buildTracePayload(opts: ITracePayloadOpts): unknown {
  return {
    streams: [
      {
        stream: { job: "tsforge-deep-review-trace", repo: opts.repo },
        values: opts.lines.map((line) => traceEntry(line, opts.prNumber)),
      },
    ],
  };
}

function traceEntry(line: string, prNumber: number): [string, string] {
  const pushTimeNs = String(BigInt(Date.now()) * 1_000_000n);

  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const ms =
      typeof parsed.timestamp === "string" ? Date.parse(parsed.timestamp) : Number.NaN;
    const timestampNs = Number.isNaN(ms) ? pushTimeNs : String(BigInt(ms) * 1_000_000n);

    return [timestampNs, JSON.stringify({ ...parsed, pr_number: prNumber })];
  } catch {
    return [pushTimeNs, line];
  }
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
