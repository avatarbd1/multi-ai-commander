import type { AcceptanceCriterion, TaskContract } from '../commander/types.js';

/**
 * A single bounded, human-scale diagnostic -- never a raw log dump. Callers
 * building a RepairRequest are expected to pass already-short values (a
 * check name plus its conclusion, a review finding's message, a process
 * exit code); `boundedDiagnostic` additionally truncates defensively so a
 * single unexpectedly long value can never balloon the request.
 */
export interface BoundedDiagnostic {
  name: string;
  detail: string;
}

const MAX_DETAIL_LENGTH = 500;

export function boundedDiagnostic(name: string, detail: string): BoundedDiagnostic {
  const trimmed = detail.length > MAX_DETAIL_LENGTH ? `${detail.slice(0, MAX_DETAIL_LENGTH)}…` : detail;
  return { name, detail: trimmed };
}

/**
 * Structured instruction sent back to the Builder for a repair attempt.
 * `kind: 'repair'` makes it explicitly distinguishable, at the Builder
 * protocol level, from an initial BuilderRequest (which carries no such
 * field) -- see ClaudeBuilderAdapter / JsonCommandBuilderProvider, which
 * pass this straight through as part of the request they already send.
 *
 * Every field here is either a small identifier/SHA or a bounded
 * diagnostic list; nothing here is a raw CI/process log. The Builder must
 * repair only the original bounded task described by `task`/
 * `acceptanceCriteria` -- this request carries no mechanism for expanding
 * scope.
 */
export interface RepairRequest {
  kind: 'repair';
  attempt: number;
  task: TaskContract;
  acceptanceCriteria: AcceptanceCriterion[];
  previousBuilderSummary: string;
  previousChangedFiles: string[];
  previousBuilderSha?: string;
  pullRequestNumber?: number;
  pullRequestHeadSha?: string;
  failingLocalChecks: BoundedDiagnostic[];
  ciFailure?: { commitSha: string; failingChecks: BoundedDiagnostic[] };
  reviewerFindings: BoundedDiagnostic[];
  verdictReasons: string[];
}
