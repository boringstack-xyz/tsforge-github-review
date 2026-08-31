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

/** Resolves `ref` to something `git diff` can actually use. After
 *  `actions/checkout`, a bare branch name like `main` (exactly what the
 *  README's `base-ref: ${{ github.event.pull_request.base.ref }}` produces)
 *  is typically NOT a locally resolvable ref — only `origin/main` is, since
 *  checkout leaves the runner in a detached HEAD with the base branch never
 *  fetched as a local branch. Try the ref as given first (for local/manual
 *  testing, where it usually IS a local branch), then fall back to
 *  `origin/<ref>` (the real CI shape), then give up with a clear error. */
async function resolveBaseRef(ref: string, cwd?: string): Promise<string> {
  if (await refExists(ref, cwd)) {
    return ref;
  }

  const originRef = `origin/${ref}`;

  if (await refExists(originRef, cwd)) {
    return originRef;
  }

  throw new Error(
    `base ref could not be resolved: neither "${ref}" nor "${originRef}" exist. ` +
      `Make sure the checkout step fetches the base branch (e.g. via fetch-depth: 0).`
  );
}

async function refExists(ref: string, cwd?: string): Promise<boolean> {
  const proc = Bun.spawn(["git", "rev-parse", "--verify", "--quiet", ref], {
    ...(cwd !== undefined ? { cwd } : {}),
    stdout: "ignore",
    stderr: "ignore",
  });

  await proc.exited;

  return proc.exitCode === 0;
}

export async function gitDiff(baseRef: string, cwd?: string): Promise<string> {
  const resolvedRef = await resolveBaseRef(baseRef, cwd);

  // `-c diff.noprefix=false -c diff.mnemonicPrefix=false --no-ext-diff` pins
  // the diff header format to git's standard `a/`/`b/` prefix convention
  // regardless of the runner's ambient git config. diff-lines.ts's file
  // header regex (`+++ b/<path>`) depends on this exact format — without
  // pinning it, a runner with `diff.noprefix=true` (or an external diff tool
  // configured) silently breaks it, routing every finding to outOfDiff. See
  // Finding 3 of the final whole-branch review.
  const proc = Bun.spawn(
    [
      "git",
      "-c",
      "diff.noprefix=false",
      "-c",
      "diff.mnemonicPrefix=false",
      "diff",
      "--no-ext-diff",
      `${resolvedRef}...HEAD`,
    ],
    {
      ...(cwd !== undefined ? { cwd } : {}),
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  const [text, stderrText] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  await proc.exited;

  if (proc.exitCode !== 0) {
    throw new Error(
      `git diff ${resolvedRef}...HEAD failed (exit ${proc.exitCode}): ${stderrText.trim()}`
    );
  }

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
