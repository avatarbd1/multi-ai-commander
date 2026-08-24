import type { BuilderOutput, CiEvidence, ReviewReport, TaskContract } from '../commander/types.js';
import type { GitHubRestClient } from '../github/client.js';
import type { PullRequestSnapshot } from '../github/types.js';
import type { ActiveReviewProvider } from '../providers/provider.js';
import { validateReviewCoverage } from './validate-review.js';

export interface IndependentReviewInput {
  task: TaskContract;
  builder: BuilderOutput;
  pullRequest: PullRequestSnapshot;
  ci: CiEvidence;
  diff: string;
}

export type IndependentReviewContext = Omit<IndependentReviewInput, 'diff'>;

export class IndependentReviewerRunner {
  public constructor(
    private readonly provider: ActiveReviewProvider<IndependentReviewInput, ReviewReport>,
    private readonly client: Pick<GitHubRestClient, 'getPullRequestDiff'>,
  ) {}

  public async run(input: IndependentReviewContext): Promise<ReviewReport> {
    if (this.provider.name.trim().toLowerCase() === input.builder.provider.trim().toLowerCase()) {
      throw new Error('REVIEWER_NOT_INDEPENDENT');
    }
    if (input.pullRequest.headSha.toLowerCase() !== input.builder.commitSha.toLowerCase()) {
      throw new Error('REVIEW_PR_SHA_MISMATCH');
    }
    if (input.ci.commitSha.toLowerCase() !== input.builder.commitSha.toLowerCase()) {
      throw new Error('REVIEW_CI_SHA_MISMATCH');
    }

    const diff = await this.client.getPullRequestDiff(input.pullRequest.repository, input.pullRequest.number);
    if (diff.trim() === '') throw new Error('REVIEW_DIFF_MISSING');
    const captured = await this.provider.review({ ...input, diff });
    if (captured.provider !== this.provider.name) throw new Error('REVIEW_PROVIDER_MISMATCH');
    const report = captured.payload;
    if (report.taskId !== input.task.id) throw new Error('REVIEW_TASK_MISMATCH');
    if (report.provider !== this.provider.name) throw new Error('REVIEW_PROVIDER_MISMATCH');
    if (!report.independentFromBuilder) throw new Error('REVIEWER_NOT_INDEPENDENT');
    const coverageErrors = validateReviewCoverage(input.task, report);
    if (coverageErrors.length > 0) throw new Error(`REVIEW_COVERAGE_INCOMPLETE:${coverageErrors.join(',')}`);
    return report;
  }
}
