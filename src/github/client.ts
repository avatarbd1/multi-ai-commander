import type { GitHubCheckRun, PullRequestSnapshot } from './types.js';
import { toCiEvidence } from './types.js';
import type { CiEvidence } from '../commander/types.js';
import type { CredentialBroker } from '../auth/types.js';

function textToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

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

interface GitHubRefResponse {
  ref: string;
  object: { sha: string };
}

interface GitHubCommentResponse {
  id: number;
  html_url: string;
}

interface GitHubContentWriteResponse {
  content: { sha: string } | null;
  commit: { sha: string };
}

interface GitHubRepositoryResponse {
  full_name: string;
}

export interface PullRequestUpdate {
  title?: string;
  body?: string;
  state?: 'open' | 'closed';
  base?: string;
}

export class GitHubRestClient {
  private readonly baseUrl = 'https://api.github.com';

  public constructor(
    private readonly token?: string,
    private readonly broker?: CredentialBroker,
    private readonly installationId?: number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async getToken(): Promise<string | undefined> {
    if (this.broker) {
      if (!this.installationId) throw new Error('GitHub App installation ID is required');
      return this.broker.getInstallationToken(this.installationId);
    }
    return this.token;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const accessToken = await this.getToken();
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(init.headers ?? {}),
        },
      });
    } catch {
      throw new Error('GitHub request failed');
    }
    if (!response.ok) throw new Error(`GitHub request failed (${response.status})`);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  public async getRepository(repository: string): Promise<{ fullName: string }> {
    const repo = await this.request<GitHubRepositoryResponse>(`/repos/${repository}`);
    return { fullName: repo.full_name };
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

  public async createBranch(repository: string, branchName: string, baseSha: string): Promise<string> {
    const result = await this.request<GitHubRefResponse>(`/repos/${repository}/git/refs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha }),
    });
    return result.object.sha;
  }

  public async createOrUpdateFile(input: {
    repository: string;
    path: string;
    content: string;
    message: string;
    branch: string;
    sha?: string;
  }): Promise<{ commitSha: string; contentSha?: string }> {
    const payload = {
      message: input.message,
      content: textToBase64(input.content),
      branch: input.branch,
      ...(input.sha ? { sha: input.sha } : {}),
    };
    const result = await this.request<GitHubContentWriteResponse>(
      `/repos/${input.repository}/contents/${input.path.split('/').map(encodeURIComponent).join('/')}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
    return {
      commitSha: result.commit.sha,
      ...(result.content?.sha ? { contentSha: result.content.sha } : {}),
    };
  }

  public async createPullRequest(
    repository: string,
    input: { title: string; body?: string; head: string; base: string; draft?: boolean },
  ): Promise<PullRequestSnapshot> {
    const created = await this.request<{ number: number }>(`/repos/${repository}/pulls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return this.getPullRequest(repository, created.number);
  }

  public async updatePullRequest(
    repository: string,
    number: number,
    updates: PullRequestUpdate,
  ): Promise<PullRequestSnapshot> {
    await this.request<GitHubPullResponse>(`/repos/${repository}/pulls/${number}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    return this.getPullRequest(repository, number);
  }

  public async createPullRequestComment(repository: string, number: number, body: string): Promise<{ id: number; url: string }> {
    const comment = await this.request<GitHubCommentResponse>(`/repos/${repository}/issues/${number}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    return { id: comment.id, url: comment.html_url };
  }
}
