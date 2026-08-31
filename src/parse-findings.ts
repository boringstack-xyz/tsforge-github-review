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
  const head = `**[${finding.lens}]** ${finding.claim}`;
  const detail = `${finding.claim}: ${finding.reason}`;
  const fix =
    finding.suggestedFix === undefined
      ? ""
      : `\n\nSuggested fix: ${finding.suggestedFix}`;

  return `${head}\n\n${detail}${fix}`;
}

/** The review's overall summary text: a mechanical verdict (error-severity
 *  findings exist, or they don't — no "worth discussing" middle state, unlike
 *  the diff-only reviewer's model-authored verdict), plus any out-of-diff
 *  findings that couldn't become inline comments. */
export function buildSummaryBody(
  findings: readonly IVerifiedFinding[],
  outOfDiff: readonly IVerifiedFinding[]
): string {
  const hasError = findings.some((f) => f.severity === "error");
  const verdictLine = hasError ? "⚠️ Needs changes" : "✅ Looks good";

  if (outOfDiff.length === 0) {
    return verdictLine;
  }

  const extra = outOfDiff
    .map((f) => `- \`${f.file}:${String(f.line)}\` — ${f.claim}: ${f.reason}`)
    .join("\n");

  return `${verdictLine}\n\n${outOfDiff.length} finding(s) reference lines outside this diff and couldn't be left as inline comments:\n\n${extra}`;
}
