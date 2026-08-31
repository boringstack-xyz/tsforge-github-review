// src/index.ts
import { runTsforgeReview } from "./run-tsforge";
import { validLines } from "./diff-lines";
import { buildReviewComments, buildSummaryBody } from "./parse-findings";
import { buildLokiPayload, pushToLoki, type ILokiPayloadOpts } from "./loki";
import { postReview } from "./github";
import type { IReviewReport } from "./types";

function requireEnv(name: string): string {
  const value = process.env[name];

  if (value === undefined || value.length === 0) {
    throw new Error(`missing required input: ${name}`);
  }

  return value;
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];

  return value === undefined || value.length === 0 ? undefined : value;
}

/** The Loki `verdict` label for a completed post. An incomplete review (any
 *  `failedReviewers`) must never report "looks_good"/"needs_changes" — those
 *  imply the review actually reached a judgment. This mirrors
 *  `buildSummaryBody`'s "❔ Incomplete review" precedence in
 *  `parse-findings.ts` so the PR-facing text and Loki telemetry agree. */
export function lokiVerdict(
  report: Pick<IReviewReport, "findings" | "failedReviewers">
): ILokiPayloadOpts["verdict"] {
  if ((report.failedReviewers ?? []).length > 0) {
    return "n/a";
  }

  return report.findings.some((f) => f.severity === "error") ? "needs_changes" : "looks_good";
}

async function gitDiff(baseRef: string): Promise<string> {
  const proc = Bun.spawn(["git", "diff", `${baseRef}...HEAD`], {
    stdout: "pipe",
    stderr: "inherit",
  });

  const text = await new Response(proc.stdout).text();
  await proc.exited;

  return text;
}

async function main(): Promise<number> {
  const token = requireEnv("INPUT_GITHUB-TOKEN");
  const baseRef = requireEnv("INPUT_BASE-REF");
  const modelUrl = optionalEnv("INPUT_MODEL-URL");
  const modelId = optionalEnv("INPUT_MODEL-ID");
  const lokiUrl = optionalEnv("INPUT_LOKI-URL");

  const [owner, repo] = requireEnv("GITHUB_REPOSITORY").split("/");
  const prNumber = Number(requireEnv("PR_NUMBER"));
  const prUrl = requireEnv("PR_URL");

  if (owner === undefined || repo === undefined) {
    throw new Error(`GITHUB_REPOSITORY is not "owner/repo": ${process.env.GITHUB_REPOSITORY}`);
  }

  const report = await runTsforgeReview({
    baseRef,
    ...(modelUrl !== undefined ? { modelUrl } : {}),
    ...(modelId !== undefined ? { modelId } : {}),
  });

  const diffText = await gitDiff(baseRef);
  const lines = validLines(diffText);
  const { comments, outOfDiff } = buildReviewComments(report.findings, lines);
  const body = buildSummaryBody(report.findings, outOfDiff, report.failedReviewers ?? []);

  const result = await postReview({ token, owner, repo, prNumber, body, comments });

  if (lokiUrl !== undefined) {
    const payload = buildLokiPayload({
      repo: `${owner}/${repo}`,
      outcome: result.ok ? "posted" : "error",
      verdict: result.ok ? lokiVerdict(report) : "n/a",
      prNumber,
      prUrl,
      timestampNs: (BigInt(Date.now()) * 1_000_000n).toString(),
    });

    await pushToLoki(lokiUrl, payload);
  }

  if (!result.ok) {
    process.stderr.write(`${result.error}\n`);

    return 1;
  }

  return 0;
}

if (import.meta.main) {
  main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
