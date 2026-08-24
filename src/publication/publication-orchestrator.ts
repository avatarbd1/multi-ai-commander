import type { BuilderOutput, TaskContract } from '../commander/types.js';
import type { GitHubRestClient } from '../github/client.js';
import type { PullRequestSnapshot } from '../github/types.js';
import type { TargetLock } from '../orchestration/target-resolver.js';
import type { BuilderWorkProduct } from '../execution/managed-builder-runner.js';

export interface PublicationResult {
  builder: BuilderOutput;
  pullRequest: PullRequestSnapshot;
}

/**
 * A branch/PR already published by a previous attempt on this same task.
 * Passing this to publish() switches it from "create" to "update" mode:
 * the branch is not (re)created and the existing Draft PR is reused rather
 * than a new one opened -- see docs/PHASE2_MANAGED_EXECUTION.md's repair
 * loop section for why one task keeps one PR across repair attempts.
 */
export interface ExistingPublication {
  branch: string;
  pullRequestNumber: number;
}

export class PublicationOrchestrator {
  public constructor(private readonly client: GitHubRestClient) {}

  public async publish(
    task: TaskContract,
    target: TargetLock,
    work: BuilderWorkProduct,
    existing?: ExistingPublication,
  ): Promise<PublicationResult> {
    if (work.baseSha.trim() === '') throw new Error('MISSING_BASE_SHA');
    if (existing && existing.branch !== work.branch) throw new Error('PUBLICATION_BRANCH_MISMATCH');
    if (!existing) {
      await this.client.createBranch(target.repository, work.branch, work.baseSha);
    }
    let pushedSha = work.baseSha;

    for (const change of work.changes) {
      // work.changes is always a diff against the task's locked base SHA,
      // not against the branch's current head. On a repair, the branch has
      // already diverged from base (it carries the previous attempt's
      // commits), so a path this diff calls "added" relative to base may
      // already exist on the branch -- and one it calls "modified" always
      // does. The actual GitHub operation is decided by presence on the
      // branch itself, which getFileMetadata checks directly; the base-
      // relative status label only distinguishes delete from write.
      const metadata = await this.client.getFileMetadata(target.repository, change.path, work.branch);
      if (change.status === 'deleted') {
        if (!metadata) throw new Error(`PUBLICATION_PATH_NOT_FOUND:${change.path}`);
        const deleted = await this.client.deleteFile({
          repository: target.repository,
          path: change.path,
          message: `${task.id}: delete ${change.path}`,
          branch: work.branch,
          sha: metadata.sha,
        });
        pushedSha = deleted.commitSha;
        continue;
      }
      if (change.content === undefined) throw new Error(`PUBLICATION_CONTENT_MISSING:${change.path}`);
      const written = await this.client.createOrUpdateFile({
        repository: target.repository,
        path: change.path,
        content: change.content,
        message: `${task.id}: ${metadata ? 'update' : 'add'} ${change.path}`,
        branch: work.branch,
        ...(metadata ? { sha: metadata.sha } : {}),
      });
      pushedSha = written.commitSha;
    }

    const pullRequest = existing
      ? await this.client.getPullRequest(target.repository, existing.pullRequestNumber)
      : await this.client.createPullRequest(target.repository, {
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
