import type { CommanderDecision, ReviewReport, TaskContract } from '../commander/types.js';
import { evaluateCommanderDecision } from '../commander/verdict.js';
import type { GitHubRestClient } from '../github/client.js';
import type { PullRequestSnapshot } from '../github/types.js';
import { AuditChain } from '../audit/hash-chain.js';
import { waitForCommitBoundCi, type CiWaitOptions } from '../ci/commit-bound-gate.js';
import { ManagedBuilderRunner } from '../execution/managed-builder-runner.js';
import { PublicationOrchestrator } from '../publication/publication-orchestrator.js';
import { IndependentReviewerRunner } from '../review/independent-reviewer-runner.js';
import { prepareTargetForBuild } from './prepare-target.js';
import {
  transitionOrchestrationState,
  type OrchestrationState,
} from './state-machine.js';

export interface ManagedCommanderDependencies {
  client: GitHubRestClient;
  builderRunner: ManagedBuilderRunner;
  publication: PublicationOrchestrator;
  reviewer: IndependentReviewerRunner;
  ci?: CiWaitOptions;
}

export interface ManagedCommanderResult {
  state: OrchestrationState;
  decision?: CommanderDecision;
  pullRequest?: PullRequestSnapshot;
  review?: ReviewReport;
  blocker?: string;
  audit: AuditChain;
}

export async function runManagedCommander(
  task: TaskContract,
  dependencies: ManagedCommanderDependencies,
): Promise<ManagedCommanderResult> {
  const audit = new AuditChain();
  await audit.append('task.contract', task);

  const prepared = await prepareTargetForBuild(dependencies.client, task.targetRepository);
  if (prepared.state === 'BLOCKED' || !prepared.target) {
    const blocker = prepared.errorCode ?? prepared.access?.code ?? 'TARGET_PREPARATION_FAILED';
    await audit.append('orchestration.blocked', { blocker });
    return { state: 'BLOCKED', blocker, audit };
  }

  const target = prepared.target;
  const baseSha = await dependencies.client.getBranchHead(target.repository, target.baseBranch);
  await audit.append('target.lock', { target, baseSha });

  let state: OrchestrationState = prepared.state;
  try {
    const work = await dependencies.builderRunner.run(task, target, baseSha);
    await audit.append('builder.work', work);

    state = transitionOrchestrationState(state, 'VERIFY');
    if (work.tests.length === 0 || work.tests.some((test) => test.conclusion !== 'success')) {
      const blocker = 'BUILD_VERIFICATION_FAILED';
      state = transitionOrchestrationState(state, 'BLOCKED');
      await audit.append('orchestration.blocked', { blocker });
      return { state, blocker, audit };
    }

    state = transitionOrchestrationState(state, 'PUBLISH');
    const publication = await dependencies.publication.publish(task, target, work);
    await audit.append('builder.output', publication.builder);
    await audit.append('pull_request.created', publication.pullRequest);

    state = transitionOrchestrationState(state, 'CI');
    const ciGate = await waitForCommitBoundCi(
      dependencies.client,
      target.repository,
      publication.builder.commitSha,
      dependencies.ci,
    );
    await audit.append('ci.evidence', ciGate.evidence);
    if (!ciGate.passed) {
      const blocker = ciGate.code;
      state = transitionOrchestrationState(state, 'BLOCKED');
      await audit.append('orchestration.blocked', { blocker });
      return { state, blocker, pullRequest: publication.pullRequest, audit };
    }

    state = transitionOrchestrationState(state, 'REVIEW');
    const review = await dependencies.reviewer.run({
      task,
      builder: publication.builder,
      pullRequest: publication.pullRequest,
      ci: ciGate.evidence,
    });
    await audit.append('review.report', review);

    state = transitionOrchestrationState(state, 'VERDICT');
    const decision = evaluateCommanderDecision({
      task,
      builder: publication.builder,
      review,
      ci: ciGate.evidence,
    });
    await audit.append('commander.verdict', decision);

    if (decision.verdict === 'PASS') {
      state = transitionOrchestrationState(state, 'HUMAN_GATE');
      return {
        state,
        decision,
        pullRequest: publication.pullRequest,
        review,
        audit,
      };
    }

    state = transitionOrchestrationState(state, 'BLOCKED');
    return {
      state,
      decision,
      pullRequest: publication.pullRequest,
      review,
      blocker: decision.verdict,
      audit,
    };
  } catch (error) {
    const blocker = error instanceof Error ? error.message : 'MANAGED_ORCHESTRATION_FAILED';
    if (state !== 'BLOCKED' && state !== 'HUMAN_GATE') {
      try {
        state = transitionOrchestrationState(state, 'BLOCKED');
      } catch {
        state = 'BLOCKED';
      }
    }
    await audit.append('orchestration.blocked', { blocker });
    return { state: 'BLOCKED', blocker, audit };
  }
}
