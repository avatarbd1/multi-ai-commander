import type { BuilderOutput, TaskContract } from '../commander/types.js';
import type { GitHubRestClient } from '../github/client.js';
import type { PullRequestSnapshot } from '../github/types.js';
import type { TargetLock } from '../orchestration/target-resolver.js';
import type { BuilderWorkProduct } from '../execution/managed-builder-runner.js';

export interface PublicationResult {
  builder: BuilderOutput;
  pullRequest: PullRequestSnapshot;
}

export class PublicationOrchestrator {
  public constructor(private readonly client: GitHubRestClient) {}

  public async publish(
    task: TaskContract,
    target: TargetLock,
    work: BuilderWorkProduct,
  ): Promise<PublicationResult> {
    if (work.baseSha.trim() === '') throw new Error('MISSING_BASE_SHA');
    await this.client.createBranch(target.repository, work.branch, work.baseSha);
    let pushedSha = work.baseSha;

    for (const change of work.changes) {
      const metadata = await this.client.getFileMetadata(target.repository, change.path, work.branch);
      if (change.status === 'added') {
        if (metadata) throw new Error(`PUBLICATION_PATH_ALREADY_EXISTS:${change.path}`);
        if (change.content === undefined) throw new Error(`PUBLICATION_CONTENT_MISSING:${change.path}`);
        const written = await this.client.createOrUpdateFile({
          repository: target.repository,
          path: change.path,
          content: change.content,
          message: `${task.id}: add ${change.path}`,
          branch: work.branch,
        });
        pushedSha = written.commitSha;
      } else if (change.status === 'modified') {
        if (!metadata) throw new Error(`PUBLICATION_PATH_NOT_FOUND:${change.path}`);
        if (change.content === undefined) throw new Error(`PUBLICATION_CONTENT_MISSING:${change.path}`);
        const written = await this.client.createOrUpdateFile({
          repository: target.repository,
          path: change.path,
          content: change.content,
          message: `${task.id}: update ${change.path}`,
          branch: work.branch,
          sha: metadata.sha,
        });
        pushedSha = written.commitSha;
      } else {
        if (!metadata) throw new Error(`PUBLICATION_PATH_NOT_FOUND:${change.path}`);
        const deleted = await this.client.deleteFile({
          repository: target.repository,
          path: change.path,
          message: `${task.id}: delete ${change.path}`,
          branch: work.branch,
          sha: metadata.sha,
        });
        pushedSha = deleted.commitSha;
      }
    }

    const pullRequest = await this.client.createPullRequest(target.repository, {
      title: task.title,
      body: `Commander task ${task.id}\n\n${task.objective}`,
      head: work.branch,
      base: target.baseBranch,
      draft: true,
    });
    if (pullRequest.headSha.toLowerCase() !== pushedSha.toLowerCase()) {
      throw new Error('PUBLISHED_PR_HEAD_MISMATCH');
    }

    return {
      builder: {
        taskId: task.id,
        provider: work.provider,
        summary: work.summary,
        branch: work.branch,
        commitSha: pushedSha,
        pullRequestNumber: pullRequest.number,
        changedFiles: work.changedFiles,
        tests: work.tests,
        knownLimitations: work.knownLimitations,
      },
      pullRequest,
    };
  }
}
