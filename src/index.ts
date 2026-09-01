// src/index.ts
//
// Shared helpers used by both entrypoints (analyze.ts, post.ts) — env
// reading, base-ref/diff resolution. Not an entrypoint itself: the action
// used to run everything from here in one job, but checking out untrusted
// PR code and holding a pull-requests: write token in the SAME job is a
// known "pwn request" vulnerability class, so the work is now split across
// two composite actions / two jobs (see README.md).

export function requireEnv(name: string): string {
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
