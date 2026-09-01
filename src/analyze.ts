// src/analyze.ts
//
// Entrypoint for the repo-root action (the "analyze" half of the split).
// This is the half that checks out and runs against untrusted PR content,
// so it deliberately takes NO github-token input at all — there is no
// input name for it to even misuse. Writes findings + the diff to files
// for a separate, checkout-free job to read and post (post/action.yml) —
// see README.md for why the work is split this way.
import { runTsforgeReview } from "./run-tsforge";
import { gitDiff, requireEnv, optionalEnv } from "./index";
import type { IReviewReport } from "./types";

export const FINDINGS_FILE = "tsforge-review-findings.json";
export const DIFF_FILE = "tsforge-review-diff.txt";

export interface IAnalyzeDeps {
  runTsforgeReview: typeof runTsforgeReview;
  gitDiff: typeof gitDiff;
  writeFile: (path: string, contents: string) => Promise<void>;
}

const defaultDeps: IAnalyzeDeps = {
  runTsforgeReview,
  gitDiff,
  writeFile: async (path, contents) => {
    await Bun.write(path, contents);
  },
};

export async function analyze(deps: IAnalyzeDeps = defaultDeps): Promise<IReviewReport> {
  const baseRef = requireEnv("INPUT_BASE-REF");
  const modelUrl = optionalEnv("INPUT_MODEL-URL");
  const modelId = optionalEnv("INPUT_MODEL-ID");

  const report = await deps.runTsforgeReview({
    baseRef,
    ...(modelUrl !== undefined ? { modelUrl } : {}),
    ...(modelId !== undefined ? { modelId } : {}),
  });

  const diffText = await deps.gitDiff(baseRef);

  await deps.writeFile(FINDINGS_FILE, JSON.stringify(report));
  await deps.writeFile(DIFF_FILE, diffText);

  return report;
}

if (import.meta.main) {
  analyze()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
