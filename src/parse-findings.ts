import type { IVerifiedFinding } from "./types";

export interface IReviewComment {
  path: string;
  line: number;
  body: string;
}

export interface IBuildCommentsResult {
  comments: IReviewComment[];
  outOfDiff: IVerifiedFinding[];
}

/** Maps findings to GitHub review comments, routing any finding whose
 *  file:line isn't part of the diff (per `validLines`) into `outOfDiff`
 *  instead — GitHub rejects the WHOLE review if one inline comment is
 *  out-of-diff, so those must never reach the comments array. */
export function buildReviewComments(
  findings: readonly IVerifiedFinding[],
  validLines: ReadonlyMap<string, ReadonlySet<number>>
): IBuildCommentsResult {
  const comments: IReviewComment[] = [];
  const outOfDiff: IVerifiedFinding[] = [];

  for (const finding of findings) {
    const fileLines = validLines.get(finding.file);

    if (fileLines !== undefined && fileLines.has(finding.line)) {
      comments.push({
        path: finding.file,
        line: finding.line,
        body: commentBody(finding),
      });
    } else {
      outOfDiff.push(finding);
    }
  }

  return { comments, outOfDiff };
}

function commentBody(finding: IVerifiedFinding): string {
  const head = `**${finding.claim}**`;
  const detail = finding.reason;
  const fix =
    finding.suggestedFix === undefined
      ? ""
      : `\n\nSuggested fix: ${finding.suggestedFix}`;

  return `${head}\n\n${detail}${fix}`;
}

/** The review's overall summary text: a mechanical verdict (error-severity
 *  findings exist, or they don't — no "worth discussing" middle state, unlike
 *  the diff-only reviewer's model-authored verdict), plus any out-of-diff
 *  findings that couldn't become inline comments.
 *
 *  `failedReviewers` (from `IReviewReport.failedReviewers`) matters here
 *  because a reviewer that fails to complete (e.g. hits its turn limit)
 *  still produces a schema-valid report with `findings: []` — without this,
 *  that reads as a clean "✅ Looks good" when in fact no review happened.
 *  Confirmed live: a real `tsforge review --json` run against tsforge PR
 *  #358 returned `{"findings":[],"failedReviewers":["review"]}` after the
 *  reviewer hit `max_turns`.
 *
 *  When any reviewer failed to complete, the verdict line itself must say so
 *  — "✅ Looks good" and "⚠️ Needs changes" both imply the review actually
 *  reached a judgment, which it didn't. This takes precedence over the
 *  findings-based verdict even if `findings` happens to be non-empty, since
 *  an incomplete review's findings can't be trusted as complete either way. */
export function buildSummaryBody(
  findings: readonly IVerifiedFinding[],
  outOfDiff: readonly IVerifiedFinding[],
  failedReviewers: readonly string[] = []
): string {
  const hasError = findings.some((f) => f.severity === "error");
  const verdictLine =
    failedReviewers.length > 0
      ? "❔ Incomplete review"
      : hasError
        ? "⚠️ Needs changes"
        : "✅ Looks good";

  const failureNote =
    failedReviewers.length === 0
      ? undefined
      : `⚠️ ${String(failedReviewers.length)} reviewer(s) did not complete (${failedReviewers.join(", ")}) — this review may be incomplete.`;

  const extraNote =
    outOfDiff.length === 0
      ? undefined
      : `${String(outOfDiff.length)} finding(s) reference lines outside this diff and couldn't be left as inline comments:\n\n${outOfDiff
          .map((f) => `- \`${f.file}:${String(f.line)}\` — ${f.claim}: ${f.reason}`)
          .join("\n")}`;

  return [verdictLine, failureNote, extraNote].filter((part) => part !== undefined).join("\n\n");
}
