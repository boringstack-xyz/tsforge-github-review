import type { IReviewComment } from "./parse-findings";

export interface IPostReviewOpts {
  token: string;
  owner: string;
  repo: string;
  prNumber: number;
  body: string;
  comments: readonly IReviewComment[];
}

export type PostReviewResult = { ok: true } | { ok: false; error: string };

/** Submits ONE review (event=COMMENT) with all findings as inline comments in
 *  a single request. Every comment's line must already be diff-valid (see
 *  `diff-lines.ts` / `parse-findings.ts`) — GitHub rejects the WHOLE review
 *  if any one comment references a line outside the diff, so filtering
 *  happens upstream, not here. */
export async function postReview(
  opts: IPostReviewOpts,
  fetchImpl: typeof fetch = fetch
): Promise<PostReviewResult> {
  const url = `https://api.github.com/repos/${opts.owner}/${opts.repo}/pulls/${String(opts.prNumber)}/reviews`;

  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      body: opts.body,
      event: "COMMENT",
      comments: opts.comments,
    }),
  });

  if (!res.ok) {
    const text = await res.text();

    return { ok: false, error: `GitHub API ${String(res.status)}: ${text}` };
  }

  return { ok: true };
}
