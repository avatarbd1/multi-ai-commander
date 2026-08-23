import type {
  BuilderOutput,
  CiEvidence,
  CommanderDecision,
  ReviewReport,
  TaskContract,
} from './types.js';
import { validateTaskContract } from './task-contract.js';

const BLOCKING_CI = new Set(['failure', 'cancelled', 'pending']);
const BLOCKING_FINDING = new Set(['critical']);
const FIX_FINDING = new Set(['high', 'medium']);

export function evaluateCommanderDecision(input: {
  task: TaskContract;
  builder: BuilderOutput;
  review: ReviewReport;
  ci: CiEvidence;
  now?: string;
}): CommanderDecision {
  const { task, builder, review, ci } = input;
  const blockedReasons: string[] = [];
  const fixReasons: string[] = [];

  const contractErrors = validateTaskContract(task);
  blockedReasons.push(...contractErrors.map((error) => `Invalid task contract: ${error}`));

  if (builder.taskId !== task.id) blockedReasons.push('Builder output taskId does not match task contract');
  if (review.taskId !== task.id) blockedReasons.push('Review taskId does not match task contract');
  if (ci.commitSha !== builder.commitSha) blockedReasons.push('CI evidence is not for the builder commit');
  if (!review.independentFromBuilder) blockedReasons.push('Reviewer must be independent from builder');
  if (review.provider.trim().toLowerCase() === builder.provider.trim().toLowerCase()) {
    blockedReasons.push('Builder and reviewer providers must be different in Phase 1');
  }

  if (ci.checks.length === 0) blockedReasons.push('No CI checks were supplied');
  for (const check of ci.checks) {
    if (BLOCKING_CI.has(check.conclusion)) {
      blockedReasons.push(`CI check ${check.name} concluded ${check.conclusion}`);
    }
  }

  for (const finding of review.findings) {
    if (BLOCKING_FINDING.has(finding.severity)) {
      blockedReasons.push(`Critical ${finding.category} finding: ${finding.message}`);
    } else if (FIX_FINDING.has(finding.severity)) {
      fixReasons.push(`${finding.severity.toUpperCase()} ${finding.category} finding: ${finding.message}`);
    }
  }

  const requirementById = new Map(review.requirements.map((entry) => [entry.criterionId, entry]));
  for (const criterion of task.acceptanceCriteria) {
    const result = requirementById.get(criterion.id);
    if (!result) {
      fixReasons.push(`Acceptance criterion ${criterion.id} was not reviewed`);
    } else if (!result.satisfied) {
      fixReasons.push(`Acceptance criterion ${criterion.id} is not satisfied`);
    } else if (criterion.evidenceRequired.length > 0 && result.evidence.length === 0) {
      fixReasons.push(`Acceptance criterion ${criterion.id} has no evidence`);
    }
  }

  if (review.recommendation === 'blocked') blockedReasons.push('Reviewer recommendation is blocked');
  if (review.recommendation === 'changes_requested') fixReasons.push('Reviewer requested changes');

  const verdict = blockedReasons.length > 0 ? 'BLOCKED' : fixReasons.length > 0 ? 'NEEDS_FIX' : 'PASS';
  const reasons = verdict === 'BLOCKED'
    ? blockedReasons
    : verdict === 'NEEDS_FIX'
      ? fixReasons
      : ['All acceptance criteria and CI gates passed'];

  return {
    taskId: task.id,
    verdict,
    reasons,
    humanGateRequired: true,
    automaticProductionDeploy: false,
    evaluatedAt: input.now ?? new Date().toISOString(),
  };
}
