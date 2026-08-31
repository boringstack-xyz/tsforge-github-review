// src/index.ts
import { runTsforgeReview } from "./run-tsforge";
import { validLines } from "./diff-lines";
import { buildReviewComments, buildSummaryBody } from "./parse-findings";
import { buildLokiPayload, pushToLoki } from "./loki";
import { postReview } from "./github";

function requireEnv(name: string): string {
  const value = process.env[name];

  if (value === undefined || value.length === 0) {
    throw new Error(`missing required input: ${name}`);
  }

  return value;
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
  const modelUrl = process.env["INPUT_MODEL-URL"];
  const modelId = process.env["INPUT_MODEL-ID"];
  const lokiUrl = process.env["INPUT_LOKI-URL"];

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
  const body = buildSummaryBody(report.findings, outOfDiff);

  const result = await postReview({ token, owner, repo, prNumber, body, comments });

  if (lokiUrl !== undefined) {
    const hasError = report.findings.some((f) => f.severity === "error");
    const payload = buildLokiPayload({
      repo: `${owner}/${repo}`,
      outcome: result.ok ? "posted" : "error",
      verdict: result.ok ? (hasError ? "needs_changes" : "looks_good") : "n/a",
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

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
