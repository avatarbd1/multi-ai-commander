import type { CommanderDecision, ReviewReport, TaskContract } from '../commander/types.js';
import { evaluateCommanderDecision } from '../commander/verdict.js';
import type { GitHubRestClient } from '../github/client.js';
import type { PullRequestSnapshot } from '../github/types.js';
import { AuditChain } from '../audit/hash-chain.js';
import { waitForCommitBoundCi, type CiWaitOptions } from '../ci/commit-bound-gate.js';
import { ManagedBuilderRunner } from '../execution/managed-builder-runner.js';
import { PublicationOrchestrator, type ExistingPublication } from '../publication/publication-orchestrator.js';
import { IndependentReviewerRunner } from '../review/independent-reviewer-runner.js';
import { prepareTargetForBuild } from './prepare-target.js';
import { transitionOrchestrationState, type OrchestrationState } from './state-machine.js';
import { createRepairPolicy, type RepairPolicy } from './repair-policy.js';
import { boundedDiagnostic, type RepairRequest } from './repair-request.js';
import { fingerprintChanges, fingerprintOutcome, isNoProgress, type AttemptFingerprint } from './repair-progress.js';

export interface ManagedCommanderDependencies {
  client: GitHubRestClient;
  builderRunner: ManagedBuilderRunner;
  publication: PublicationOrchestrator;
  reviewer: IndependentReviewerRunner;
  ci?: CiWaitOptions;
  /** Defaults to createRepairPolicy() (2 repair cycles) when omitted. */
  repairPolicy?: RepairPolicy;
}

export interface ManagedCommanderResult {
  state: OrchestrationState;
  /** Total builder invocations actually executed: 1 for a run with no repair. */
  attempts: number;
  decision?: CommanderDecision;
  pullRequest?: PullRequestSnapshot;
  review?: ReviewReport;
  blocker?: string;
  /** The exact commit SHA the final decision applies to, when a publish happened. */
  finalSha?: string;
  audit: AuditChain;
}

interface BlockedParams {
  audit: AuditChain;
  attempts: number;
  blocker: string;
  pullRequest?: PullRequestSnapshot | undefined;
  review?: ReviewReport | undefined;
  decision?: CommanderDecision | undefined;
}

async function blockedResult(params: BlockedParams): Promise<ManagedCommanderResult> {
  await params.audit.append('orchestration.blocked', { blocker: params.blocker, attempts: params.attempts });
  return {
    state: 'BLOCKED',
    attempts: params.attempts,
    blocker: params.blocker,
    audit: params.audit,
    ...(params.pullRequest ? { pullRequest: params.pullRequest, finalSha: params.pullRequest.headSha } : {}),
    ...(params.review ? { review: params.review } : {}),
    ...(params.decision ? { decision: params.decision } : {}),
  };
}

/**
 * Turns a repairable failure into the next attempt: records the REPAIR
 * transition (visible in both `state` and the audit trail), advances the
 * attempt counter, and returns the RepairRequest to carry into the next
 * BUILD. Never called for a non-retryable failure -- those are handled by
 * throwing (caught once, below) or by an early blockedResult() return, so
 * they can never reach a repair.
 */
async function enterRepair(params: {
  audit: AuditChain;
  attempt: number;
  trigger: string;
  request: RepairRequest;
}): Promise<void> {
  await params.audit.append('orchestration.repair', {
    fromAttempt: params.attempt,
    toAttempt: params.request.attempt,
    trigger: params.trigger,
  });
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
    return blockedResult({ audit, attempts: 0, blocker });
  }

  const target = prepared.target;
  const baseSha = await dependencies.client.getBranchHead(target.repository, target.baseBranch);
  await audit.append('target.lock', { target, baseSha });

  const policy = dependencies.repairPolicy ?? createRepairPolicy();

  let state: OrchestrationState = prepared.state;
  let attempt = 1;
  let repairContext: RepairRequest | undefined;
  let previousFingerprint: AttemptFingerprint | undefined;
  let existingPublication: ExistingPublication | undefined;
  let lastPullRequest: PullRequestSnapshot | undefined;
  let lastReview: ReviewReport | undefined;
  let lastDecision: CommanderDecision | undefined;

  try {
    for (;;) {
      await audit.append('orchestration.attempt', { attempt, repair: repairContext !== undefined });

      const work = await dependencies.builderRunner.run(task, target, baseSha, repairContext);
      await audit.append('builder.work', { attempt, summary: work.summary, changedFiles: work.changedFiles, tests: work.tests });

      state = transitionOrchestrationState(state, 'VERIFY');
      const failingTests = work.tests.filter((test) => test.conclusion !== 'success');
      if (work.tests.length === 0 || failingTests.length > 0) {
        const fingerprint: AttemptFingerprint = {
          changeSignature: await fingerprintChanges(work.changes),
          outcomeSignature: fingerprintOutcome([
            'LOCAL',
            ...failingTests.map((test) => `${test.name}=${test.conclusion}`),
          ]),
        };
        if (isNoProgress(previousFingerprint, fingerprint)) {
          return blockedResult({ audit, attempts: attempt, blocker: 'NO_PROGRESS_DETECTED', pullRequest: lastPullRequest });
        }
        if (attempt - 1 >= policy.maxRepairCycles) {
          return blockedResult({ audit, attempts: attempt, blocker: 'REPAIR_LIMIT_EXCEEDED', pullRequest: lastPullRequest });
        }
        previousFingerprint = fingerprint;
        const repairRequest: RepairRequest = {
          kind: 'repair',
          attempt: attempt + 1,
          task,
          acceptanceCriteria: task.acceptanceCriteria,
          previousBuilderSummary: work.summary,
          previousChangedFiles: work.changedFiles,
          failingLocalChecks: failingTests.map((test) =>
            boundedDiagnostic(test.name, `${test.conclusion} (${test.evidence ?? 'no evidence'})`),
          ),
          reviewerFindings: [],
          verdictReasons: [],
          ...(existingPublication
            ? { pullRequestNumber: existingPublication.pullRequestNumber, ...(lastPullRequest ? { pullRequestHeadSha: lastPullRequest.headSha } : {}) }
            : {}),
        };
        await enterRepair({ audit, attempt, trigger: 'LOCAL_VERIFICATION_FAILED', request: repairRequest });
        state = transitionOrchestrationState(state, 'REPAIR');
        state = transitionOrchestrationState(state, 'BUILD');
        attempt = repairRequest.attempt;
        repairContext = repairRequest;
        continue;
      }

      // Base-branch drift guard (item G): a repair republishes against the
      // SAME locked baseSha it started with. If main has moved since, that
      // assumption is stale -- fail closed instead of silently continuing
      // as if nothing changed. The first attempt trusts the SHA it just
      // locked a moment ago.
      if (attempt > 1) {
        const currentBaseHead = await dependencies.client.getBranchHead(target.repository, target.baseBranch);
        if (currentBaseHead.toLowerCase() !== baseSha.toLowerCase()) {
          return blockedResult({ audit, attempts: attempt, blocker: 'BASE_BRANCH_DRIFTED', pullRequest: lastPullRequest });
        }
      }

      state = transitionOrchestrationState(state, 'PUBLISH');
      const publication = await dependencies.publication.publish(task, target, work, existingPublication);
      await audit.append('builder.output', { attempt, ...publication.builder });
      await audit.append(existingPublication ? 'pull_request.updated' : 'pull_request.created', { attempt, ...publication.pullRequest });
      lastPullRequest = publication.pullRequest;
      existingPublication = { branch: work.branch, pullRequestNumber: publication.pullRequest.number };

      // Fresh, exact-SHA CI evidence for THIS attempt's commit -- never the
      // previous attempt's. waitForCommitBoundCi always queries by the
      // exact commit just published, so there is no code path here that
      // could reuse stale evidence from an earlier attempt.
      state = transitionOrchestrationState(state, 'CI');
      const ciGate = await waitForCommitBoundCi(dependencies.client, target.repository, publication.builder.commitSha, dependencies.ci);
      await audit.append('ci.evidence', { attempt, code: ciGate.code, evidence: ciGate.evidence });
      if (!ciGate.passed) {
        if (ciGate.code !== 'CI_NOT_SUCCESS') {
          // CI_SHA_MISMATCH, CI_MISSING, CI_PENDING(exhausted): stale/
          // absent evidence, not a real failure with diagnostics to repair.
          return blockedResult({ audit, attempts: attempt, blocker: ciGate.code, pullRequest: publication.pullRequest });
        }
        const fingerprint: AttemptFingerprint = {
          changeSignature: await fingerprintChanges(work.changes),
          outcomeSignature: fingerprintOutcome([
            'CI',
            ...ciGate.evidence.checks.filter((check) => check.conclusion !== 'success').map((check) => `${check.name}=${check.conclusion}`),
          ]),
        };
        if (isNoProgress(previousFingerprint, fingerprint)) {
          return blockedResult({ audit, attempts: attempt, blocker: 'NO_PROGRESS_DETECTED', pullRequest: publication.pullRequest });
        }
        if (attempt - 1 >= policy.maxRepairCycles) {
          return blockedResult({ audit, attempts: attempt, blocker: 'REPAIR_LIMIT_EXCEEDED', pullRequest: publication.pullRequest });
        }
        previousFingerprint = fingerprint;
        const repairRequest: RepairRequest = {
          kind: 'repair',
          attempt: attempt + 1,
          task,
          acceptanceCriteria: task.acceptanceCriteria,
          previousBuilderSummary: work.summary,
          previousChangedFiles: work.changedFiles,
          previousBuilderSha: publication.builder.commitSha,
          pullRequestNumber: publication.pullRequest.number,
          pullRequestHeadSha: publication.pullRequest.headSha,
          failingLocalChecks: [],
          ciFailure: {
            commitSha: ciGate.evidence.commitSha,
            failingChecks: ciGate.evidence.checks
              .filter((check) => check.conclusion !== 'success')
              .map((check) => boundedDiagnostic(check.name, `${check.conclusion}${check.url ? ` (${check.url})` : ''}`)),
          },
          reviewerFindings: [],
          verdictReasons: [],
        };
        await enterRepair({ audit, attempt, trigger: 'CI_FAILED', request: repairRequest });
        state = transitionOrchestrationState(state, 'REPAIR');
        state = transitionOrchestrationState(state, 'BUILD');
        attempt = repairRequest.attempt;
        repairContext = repairRequest;
        continue;
      }

      // Reviewer independently re-fetches the exact remote diff for THIS
      // commit and re-validates PR/CI SHA equality itself
      // (IndependentReviewerRunner) -- so a repair can never carry forward
      // a stale review either.
      state = transitionOrchestrationState(state, 'REVIEW');
      const review = await dependencies.reviewer.run({
        task,
        builder: publication.builder,
        pullRequest: publication.pullRequest,
        ci: ciGate.evidence,
      });
      await audit.append('review.report', { attempt, ...review });
      lastReview = review;

      state = transitionOrchestrationState(state, 'VERDICT');
      const decision = evaluateCommanderDecision({ task, builder: publication.builder, review, ci: ciGate.evidence });
      await audit.append('commander.verdict', { attempt, ...decision });
      lastDecision = decision;

      if (decision.verdict === 'PASS') {
        state = transitionOrchestrationState(state, 'HUMAN_GATE');
        return {
          state,
          attempts: attempt,
          decision,
          pullRequest: publication.pullRequest,
          review,
          finalSha: publication.builder.commitSha,
          audit,
        };
      }

      if (decision.verdict !== 'NEEDS_FIX') {
        return blockedResult({ audit, attempts: attempt, blocker: decision.verdict, pullRequest: publication.pullRequest, review, decision });
      }

      const fingerprint: AttemptFingerprint = {
        changeSignature: await fingerprintChanges(work.changes),
        outcomeSignature: fingerprintOutcome([
          'VERDICT',
          ...decision.reasons,
          ...review.findings.map((finding) => `${finding.category}:${finding.severity}:${finding.message}`),
        ]),
      };
      if (isNoProgress(previousFingerprint, fingerprint)) {
        return blockedResult({ audit, attempts: attempt, blocker: 'NO_PROGRESS_DETECTED', pullRequest: publication.pullRequest, review, decision });
      }
      if (attempt - 1 >= policy.maxRepairCycles) {
        return blockedResult({ audit, attempts: attempt, blocker: 'REPAIR_LIMIT_EXCEEDED', pullRequest: publication.pullRequest, review, decision });
      }
      previousFingerprint = fingerprint;
      const repairRequest: RepairRequest = {
        kind: 'repair',
        attempt: attempt + 1,
        task,
        acceptanceCriteria: task.acceptanceCriteria,
        previousBuilderSummary: work.summary,
        previousChangedFiles: work.changedFiles,
        previousBuilderSha: publication.builder.commitSha,
        pullRequestNumber: publication.pullRequest.number,
        pullRequestHeadSha: publication.pullRequest.headSha,
        failingLocalChecks: [],
        reviewerFindings: review.findings.map((finding) => boundedDiagnostic(`${finding.category}:${finding.severity}`, finding.message)),
        verdictReasons: decision.reasons,
      };
      await enterRepair({ audit, attempt, trigger: 'NEEDS_FIX', request: repairRequest });
      state = transitionOrchestrationState(state, 'REPAIR');
      state = transitionOrchestrationState(state, 'BUILD');
      attempt = repairRequest.attempt;
      repairContext = repairRequest;
    }
  } catch (error) {
    const blocker = error instanceof Error ? error.message : 'MANAGED_ORCHESTRATION_FAILED';
    return blockedResult({ audit, attempts: attempt, blocker, pullRequest: lastPullRequest, review: lastReview, decision: lastDecision });
  }
}
