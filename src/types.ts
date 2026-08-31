export type Severity = "error" | "warning" | "info";

export interface IVerifiedFinding {
  file: string;
  line: number;
  severity: Severity;
  lens: string;
  claim: string;
  reason: string;
  suggestedFix?: string;
  verified: boolean;
  verdict: string;
}

export interface IReviewReport {
  base: string;
  changedFiles: string[];
  findings: IVerifiedFinding[];
  rejected: number;
  gateFailingRules?: string[];
  failedReviewers?: string[];
  totalChangedFiles?: number;
}

export function isReviewReport(value: unknown): value is IReviewReport {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return Array.isArray(record.findings) && Array.isArray(record.changedFiles);
}
