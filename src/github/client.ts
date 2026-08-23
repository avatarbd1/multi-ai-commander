import type { GitHubCheckRun, PullRequestSnapshot } from './types.js';
import { toCiEvidence } from './types.js';
import type { CiEvidence } from '../commander/types.js';

interface GitHubPullResponse {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  html_url: string;
  head: { sha: string; ref: string };
  base: { ref: string };
}

interface GitHubFileResponse {
  filename: string;
}

interface GitHubChecksResponse {
  check_runs: GitHubCheckRun[];
}

export class GitHubRestClient {
  private readonly baseUrl = 'https://api.github.com';

  public constructor(private readonly token?: string) {}

  private async request<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
    });
    if (!response.ok) throw new Error(`GitHub request failed: ${response.status} ${response.statusText}`);
    return (await response.json()) as T;
  }

  public async getPullRequest(repository: string, number: number): Promise<PullRequestSnapshot> {
    const pull = await this.request<GitHubPullResponse>(`/repos/${repository}/pulls/${number}`);
    const files = await this.request<GitHubFileResponse[]>(`/repos/${repository}/pulls/${number}/files?per_page=100`);
    return {
      repository,
      number: pull.number,
      title: pull.title,
      state: pull.state,
      headSha: pull.head.sha,
      headBranch: pull.head.ref,
      baseBranch: pull.base.ref,
      draft: pull.draft,
      changedFiles: files.map((file) => file.filename),
      url: pull.html_url,
    };
  }

  public async getCiEvidence(repository: string, commitSha: string): Promise<CiEvidence> {
    const response = await this.request<GitHubChecksResponse>(`/repos/${repository}/commits/${commitSha}/check-runs?per_page=100`);
    return toCiEvidence(commitSha, response.check_runs);
  }
}
