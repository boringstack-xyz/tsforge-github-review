// src/run-tsforge.ts
import { isReviewReport, type IReviewReport } from "./types";

export function parseTsforgeOutput(stdout: string): IReviewReport {
  let parsed: unknown;

  try {
    parsed = JSON.parse(stdout);
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
