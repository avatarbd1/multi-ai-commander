import type { CheckConclusion, CiEvidence } from '../commander/types.js';

export interface PullRequestSnapshot {
  repository: string;
  number: number;
  title: string;
  state: string;
  headSha: string;
  headBranch: string;
  baseBranch: string;
  draft: boolean;
  changedFiles: string[];
  url: string;
}

export interface GitHubCheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  details_url?: string | null;
}

export function normalizeGitHubConclusion(status: string, conclusion: string | null): CheckConclusion {
  if (status !== 'completed') return 'pending';
  switch (conclusion) {
    case 'success':
      return 'success';
    case 'neutral':
      return 'neutral';
    case 'skipped':
      return 'skipped';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'failure';
  }
}

export function toCiEvidence(commitSha: string, runs: GitHubCheckRun[]): CiEvidence {
  return {
    commitSha,
    checks: runs.map((run) => ({
      name: run.name,
      conclusion: normalizeGitHubConclusion(run.status, run.conclusion),
      ...(run.details_url ? { url: run.details_url } : {}),
    })),
  };
}
