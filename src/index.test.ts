// src/index.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { optionalEnv, lokiVerdict, gitDiff } from "./index";
import { validLines } from "./diff-lines";
import type { IVerifiedFinding } from "./types";

function finding(overrides: Partial<IVerifiedFinding> = {}): IVerifiedFinding {
  return {
    file: "src/a.ts",
    line: 12,
    severity: "error",
    lens: "correctness",
    claim: "off-by-one in the loop bound",
    reason: "index i can reach array.length, throwing on the last iteration",
    verified: true,
    verdict: "confirmed",
    ...overrides,
  };
}

describe(optionalEnv.name, () => {
  const testVarName = "TEST_OPTIONAL_VAR_12345";

  beforeEach(() => {
    delete process.env[testVarName];
  });

  afterEach(() => {
    delete process.env[testVarName];
  });

  test("returns undefined when env var is not set", () => {
    expect(optionalEnv(testVarName)).toBeUndefined();
  });

  test("returns undefined when env var is an empty string", () => {
    process.env[testVarName] = "";
    expect(optionalEnv(testVarName)).toBeUndefined();
  });

  test("returns the value when env var is a non-empty string", () => {
    process.env[testVarName] = "some-value";
    expect(optionalEnv(testVarName)).toBe("some-value");
  });
});

describe(lokiVerdict.name, () => {
  test("returns needs_changes when any finding is error-severity", () => {
    expect(lokiVerdict({ findings: [finding({ severity: "error" })] })).toBe("needs_changes");
  });

  test("returns looks_good when there are no findings at all", () => {
    expect(lokiVerdict({ findings: [] })).toBe("looks_good");
  });

  test("returns looks_good when findings exist but none are error-severity", () => {
    expect(lokiVerdict({ findings: [finding({ severity: "warning" })] })).toBe("looks_good");
  });

  // A reviewer that fails to complete produces a schema-valid report with
  // `findings: []` — without checking failedReviewers, that reads as
  // "looks_good" telemetry for a review that never actually happened.
  test("returns n/a when a reviewer failed to complete, even with no findings", () => {
    expect(lokiVerdict({ findings: [], failedReviewers: ["review"] })).toBe("n/a");
  });

  // failedReviewers takes precedence over the findings-based verdict, same
  // as buildSummaryBody's verdict line — an incomplete review's findings
  // can't be trusted as complete either way.
  test("returns n/a when a reviewer failed to complete, even with error findings", () => {
    expect(
      lokiVerdict({ findings: [finding({ severity: "error" })], failedReviewers: ["review"] })
    ).toBe("n/a");
  });

  test("returns looks_good when failedReviewers is undefined", () => {
    expect(lokiVerdict({ findings: [] })).toBe("looks_good");
  });

  test("returns looks_good when failedReviewers is an empty array", () => {
    expect(lokiVerdict({ findings: [], failedReviewers: [] })).toBe("looks_good");
  });
});

/** Runs a git command against a real temp repo and returns stdout, throwing
 *  with stderr context on a nonzero exit — used only to set up test repos. */
async function runGit(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  await proc.exited;

  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd} (exit ${proc.exitCode}): ${stderr}`);
  }

  return stdout;
}

async function initRepo(dir: string): Promise<void> {
  await runGit(["init", "-b", "main"], dir);
  await runGit(["config", "user.email", "test@example.com"], dir);
  await runGit(["config", "user.name", "Test"], dir);
}

async function commitFile(dir: string, name: string, contents: string, message: string): Promise<void> {
  await Bun.write(join(dir, name), contents);
  await runGit(["add", name], dir);
  await runGit(["commit", "-m", message], dir);
}

// Finding 1 (final whole-branch review): gitDiff() must not silently swallow
// a failed `git diff` (empty diff -> every finding routed to outOfDiff), and
// must resolve a bare branch name whether it's a local branch (manual/local
// testing) or only exists as `origin/<ref>` (the real actions/checkout shape,
// where the base branch is never fetched as a local branch). Uses real temp
// git repos, not mocks — that's the only way to genuinely exercise git's own
// ref-resolution and exit-code behavior.
describe(gitDiff.name, () => {
  test("resolves and diffs a base ref that exists as a local branch", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gitdiff-local-"));

    try {
      await initRepo(dir);
      await commitFile(dir, "a.txt", "hello\n", "init");
      await runGit(["checkout", "-b", "feature"], dir);
      await commitFile(dir, "a.txt", "hello\nworld\n", "add world");

      const diff = await gitDiff("main", dir);

      expect(diff).toContain("+++ b/a.txt");
      expect(diff).toContain("+world");
      expect(validLines(diff).get("a.txt")).toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("falls back to origin/<ref> when the base ref only exists as a remote-tracking ref", async () => {
    const originDir = await mkdtemp(join(tmpdir(), "gitdiff-origin-"));
    const workDir = await mkdtemp(join(tmpdir(), "gitdiff-work-"));

    try {
      await initRepo(originDir);
      await commitFile(originDir, "a.txt", "hello\n", "init");

      // Mirrors actions/checkout: after cloning, delete the local `main`
      // branch so only `origin/main` (a remote-tracking ref) resolves, and
      // leave HEAD detached at a PR-only commit — exactly the shape a real
      // CI checkout leaves behind.
      await runGit(["clone", originDir, workDir], tmpdir());
      await runGit(["checkout", "--detach"], workDir);
      await runGit(["branch", "-D", "main"], workDir);
      await commitFile(workDir, "a.txt", "hello\nworld\n", "add world");

      const diff = await gitDiff("main", workDir);

      expect(diff).toContain("+++ b/a.txt");
      expect(diff).toContain("+world");
    } finally {
      await rm(originDir, { recursive: true, force: true });
      await rm(workDir, { recursive: true, force: true });
    }
  });

  test("throws a clear error when the base ref is not resolvable locally or via origin/<ref>", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gitdiff-missing-"));

    try {
      await initRepo(dir);
      await commitFile(dir, "a.txt", "hello\n", "init");

      await expect(gitDiff("no-such-branch", dir)).rejects.toThrow(
        'base ref could not be resolved: neither "no-such-branch" nor "origin/no-such-branch" exist'
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // Finding 3 (final whole-branch review): gitDiff() pins the diff header
  // format so diff-lines.ts's `+++ b/<path>` regex always matches, even when
  // the runner's ambient git config would otherwise break it.
  test("still produces the standard a/ b/ diff header even when the repo config sets diff.noprefix", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gitdiff-noprefix-"));

    try {
      await initRepo(dir);
      await runGit(["config", "diff.noprefix", "true"], dir);
      await commitFile(dir, "a.txt", "hello\n", "init");
      await runGit(["checkout", "-b", "feature"], dir);
      await commitFile(dir, "a.txt", "hello\nworld\n", "add world");

      const diff = await gitDiff("main", dir);

      expect(diff).toContain("+++ b/a.txt");
      expect(validLines(diff).get("a.txt")).toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
