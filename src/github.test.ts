import { describe, test, expect, mock } from "bun:test";
import { postReview } from "./github";

describe(postReview.name, () => {
  test("POSTs a COMMENT-event review with the comments array and body", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = mock(async (url: string, init: RequestInit) => {
      calls.push({ url, init });

      return new Response(JSON.stringify({ id: 1 }), { status: 200 });
    });

    const result = await postReview(
      {
        token: "ghp_test",
        owner: "octocat",
        repo: "hello-world",
        prNumber: 371,
        body: "✅ Looks good",
        comments: [{ path: "src/a.ts", line: 12, body: "finding text" }],
      },
      fakeFetch as unknown as typeof fetch
    );

    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://api.github.com/repos/octocat/hello-world/pulls/371/reviews"
    );

    const sentBody = JSON.parse(String(calls[0]?.init.body));

    expect(sentBody).toEqual({
      body: "✅ Looks good",
      event: "COMMENT",
      comments: [{ path: "src/a.ts", line: 12, body: "finding text" }],
    });
    expect(calls[0]?.init.headers).toMatchObject({
      Authorization: "Bearer ghp_test",
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    });
  });

  test("returns ok:false with the response body on a non-2xx status", async () => {
    const fakeFetch = mock(
      async () => new Response(JSON.stringify({ message: "Validation Failed" }), { status: 422 })
    );

    const result = await postReview(
      {
        token: "t",
        owner: "o",
        repo: "r",
        prNumber: 1,
        body: "x",
        comments: [],
      },
      fakeFetch as unknown as typeof fetch
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("422");
      expect(result.error).toContain("Validation Failed");
    }
  });
});
