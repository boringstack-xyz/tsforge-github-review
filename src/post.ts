// src/post.ts
//
// Entrypoint for the post/ action (the "post" half of the split). Never
// checks out PR code and never runs tsforge — reads the findings + diff
// files a prior analyze job already produced (via an uploaded artifact),
// and does the one thing that needs a pull-requests: write token: post
// the review. Keeping this job checkout-free is what makes granting it
// that token safe — see README.md for the full split rationale.
import { readFile } from "node:fs/promises";
import { validLines } from "./diff-lines";
import { buildReviewComments, buildSummaryBody } from "./parse-findings";
import { buildLokiPayload, pushToLoki, type ILokiPayloadOpts } from "./loki";
import { postReview } from "./github";
import { requireEnv, optionalEnv } from "./index";
import { isReviewReport, type IReviewReport } from "./types";

/** Mirrors `buildSummaryBody`'s "❔ Incomplete review" precedence so the
 *  PR-facing text and Loki telemetry always agree: an incomplete review
 *  (any `failedReviewers`) must never report "looks_good"/"needs_changes"
 *  — those imply the review actually reached a judgment. */
export function lokiVerdict(
  report: Pick<IReviewReport, "findings" | "failedReviewers">
): ILokiPayloadOpts["verdict"] {
  if ((report.failedReviewers ?? []).length > 0) {
    return "n/a";
  }

  return report.findings.some((f) => f.severity === "error") ? "needs_changes" : "looks_good";
}

export async function readReport(path: string): Promise<IReviewReport> {
  const raw = await readFile(path, "utf8");
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${path} did not contain valid JSON`);
  }

  if (!isReviewReport(parsed)) {
    throw new Error(`${path} did not contain a valid IReviewReport`);
  }

  return parsed;
}

export async function post(): Promise<number> {
  const token = requireEnv("INPUT_GITHUB-TOKEN");
  const findingsFile = requireEnv("INPUT_FINDINGS-FILE");
  const diffFile = requireEnv("INPUT_DIFF-FILE");
  const lokiUrl = optionalEnv("INPUT_LOKI-URL");

  const [owner, repo] = requireEnv("GITHUB_REPOSITORY").split("/");
  const prNumber = Number(requireEnv("PR_NUMBER"));
  const prUrl = requireEnv("PR_URL");

  if (owner === undefined || repo === undefined) {
    throw new Error(`GITHUB_REPOSITORY is not "owner/repo": ${process.env.GITHUB_REPOSITORY}`);
  }

  const report = await readReport(findingsFile);
  const diffText = await readFile(diffFile, "utf8");
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
  post()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
