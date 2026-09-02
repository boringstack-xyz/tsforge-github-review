// src/run-tsforge.ts
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { isReviewReport, type IReviewReport } from "./types";

const STDOUT_EXCERPT_LENGTH = 200;

/** Trailing excerpt of raw stdout for error messages — the JSON (or garbage
 *  in its place) is the last thing printed, so the tail is what's diagnostic.
 *  Truncated to avoid dumping huge output into an error message. */
function stdoutExcerpt(stdout: string): string {
  const trimmed = stdout.trim();

  if (trimmed.length <= STDOUT_EXCERPT_LENGTH) {
    return trimmed;
  }

  return `...${trimmed.slice(trimmed.length - STDOUT_EXCERPT_LENGTH)}`;
}

/** `tsforge review --json` prints human-readable progress/gate lines to
 *  stdout before the report — the JSON is documented (args.ts) as the LAST
 *  line of stdout, not the whole stream. Parse only that line. */
export function parseTsforgeOutput(stdout: string): IReviewReport {
  const lines = stdout.split("\n").filter((line) => line.trim().length > 0);
  const lastLine = lines[lines.length - 1];

  let parsed: unknown;

  try {
    parsed = lastLine === undefined ? JSON.parse(stdout) : JSON.parse(lastLine);
  } catch {
    throw new Error(
      `tsforge review --json did not produce a valid IReviewReport (stdout: "${stdoutExcerpt(stdout)}")`
    );
  }

  if (!isReviewReport(parsed)) {
    throw new Error(
      `tsforge review --json did not produce a valid IReviewReport (stdout: "${stdoutExcerpt(stdout)}")`
    );
  }

  return parsed;
}

export interface IRunTsforgeOpts {
  baseRef: string;
  modelUrl?: string;
  modelId?: string;
}

/** Builds the environment for the spawned `tsforge` subprocess. `tsforge
 *  review` is agentic — it runs tools against untrusted PR content — so it
 *  must never receive a `pull-requests: write`-scoped GitHub token. Strips
 *  both this action's own `INPUT_GITHUB-TOKEN` and any `GITHUB_TOKEN` the
 *  calling workflow might also have set; `tsforge` has no legitimate need for
 *  either. Exported (and given a plain `processEnv` param, not a `process.env`
 *  read) so the stripping can be asserted without spawning a real process. */
export function buildTsforgeEnv(
  opts: IRunTsforgeOpts,
  processEnv: Record<string, string | undefined>
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...processEnv };

  delete env["INPUT_GITHUB-TOKEN"];
  delete env.GITHUB_TOKEN;

  if (opts.modelUrl !== undefined) {
    env.TSFORGE_BASE_URL = opts.modelUrl;
  }

  if (opts.modelId !== undefined) {
    env.TSFORGE_MODEL = opts.modelId;
  }

  return env;
}

/** Spawns `tsforge review --base <ref> --json --log` in the current working
 *  directory (the already-checked-out PR) and returns its parsed report.
 *  Model selection is env-var based per TSForge's own convention
 *  (TSFORGE_BASE_URL / TSFORGE_MODEL — confirmed in models-config.ts). */
export async function runTsforgeReview(opts: IRunTsforgeOpts): Promise<IReviewReport> {
  const env = buildTsforgeEnv(opts, process.env);

  const proc = Bun.spawn(["tsforge", "review", "--base", opts.baseRef, "--json", "--log"], {
    env,
    stdout: "pipe",
    stderr: "inherit",
  });

  const stdout = await new Response(proc.stdout).text();
  await proc.exited;

  return parseTsforgeOutput(stdout);
}

/** `--log`'s file isn't addressable by path — tsforge auto-names it under
 *  $TSFORGE_HOME/.tsforge/logs (else $HOME), and doesn't export that
 *  resolution for other packages to import, so it's replicated here. */
function tsforgeLogsDir(): string {
  return join(process.env.TSFORGE_HOME ?? homedir(), ".tsforge", "logs");
}

/** Best-effort: the newest --log JSONL's non-empty lines, or [] on any
 *  failure — a missing/unreadable trace must never fail the review. Each
 *  ephemeral runner pod runs exactly one `tsforge review` per lifetime, so
 *  "newest" (filenames are ISO-timestamp-prefixed, sorting chronologically)
 *  is never a stale file left over from a prior run. */
export async function readLatestTraceLog(): Promise<string[]> {
  try {
    const dir = tsforgeLogsDir();
    const names = (await readdir(dir)).filter((n) => n.endsWith(".jsonl")).sort();
    const newest = names[names.length - 1];

    if (newest === undefined) {
      return [];
    }

    const raw = await readFile(join(dir, newest), "utf8");

    return raw.split("\n").filter((line) => line.trim().length > 0);
  } catch {
    return [];
  }
}
