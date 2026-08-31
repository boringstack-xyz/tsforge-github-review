// src/run-tsforge.ts
import { isReviewReport, type IReviewReport } from "./types";

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
    throw new Error("tsforge review --json did not produce a valid IReviewReport");
  }

  if (!isReviewReport(parsed)) {
    throw new Error("tsforge review --json did not produce a valid IReviewReport");
  }

  return parsed;
}

export interface IRunTsforgeOpts {
  baseRef: string;
  modelUrl?: string;
  modelId?: string;
}

/** Spawns `tsforge review --base <ref> --json` in the current working
 *  directory (the already-checked-out PR) and returns its parsed report.
 *  Model selection is env-var based per TSForge's own convention
 *  (TSFORGE_BASE_URL / TSFORGE_MODEL — confirmed in models-config.ts). */
export async function runTsforgeReview(opts: IRunTsforgeOpts): Promise<IReviewReport> {
  const env: Record<string, string | undefined> = { ...process.env };

  if (opts.modelUrl !== undefined) {
    env.TSFORGE_BASE_URL = opts.modelUrl;
  }

  if (opts.modelId !== undefined) {
    env.TSFORGE_MODEL = opts.modelId;
  }

  const proc = Bun.spawn(["tsforge", "review", "--base", opts.baseRef, "--json"], {
    env,
    stdout: "pipe",
    stderr: "inherit",
  });

  const stdout = await new Response(proc.stdout).text();
  await proc.exited;

  return parseTsforgeOutput(stdout);
}
