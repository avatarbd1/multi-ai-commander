export type OrchestrationState =
  | 'TASK'
  | 'TARGET_LOCK'
  | 'TARGET_ACCESS_VERIFY'
  | 'BUILD'
  | 'VERIFY'
  | 'PUBLISH'
  | 'CI'
  | 'REVIEW'
  | 'VERDICT'
  | 'REPAIR'
  | 'HUMAN_GATE'
  | 'BLOCKED';

/**
 * REPAIR is entered only from a stage that found a *repairable* failure
 * (VERIFY: local verification failed; CI: commit-bound CI failed with real
 * check evidence; VERDICT: deterministic verdict was NEEDS_FIX) and always
 * leads back to BUILD -- a repair is just another builder invocation, now
 * carrying a structured RepairRequest, followed by the same
 * VERIFY -> PUBLISH -> CI -> REVIEW -> VERDICT sequence. Every other
 * failure at any stage transitions straight to BLOCKED with no REPAIR hop,
 * by construction: those stages simply never offer REPAIR as a target.
 */
const FORWARD_TRANSITIONS: Readonly<Record<OrchestrationState, readonly OrchestrationState[]>> = {
  TASK: ['TARGET_LOCK', 'BLOCKED'],
  TARGET_LOCK: ['TARGET_ACCESS_VERIFY', 'BLOCKED'],
  TARGET_ACCESS_VERIFY: ['BUILD', 'BLOCKED'],
  BUILD: ['VERIFY', 'BLOCKED'],
  VERIFY: ['PUBLISH', 'REPAIR', 'BLOCKED'],
  PUBLISH: ['CI', 'BLOCKED'],
  CI: ['REVIEW', 'REPAIR', 'BLOCKED'],
  REVIEW: ['VERDICT', 'BLOCKED'],
  VERDICT: ['HUMAN_GATE', 'REPAIR', 'BLOCKED'],
  REPAIR: ['BUILD', 'BLOCKED'],
  HUMAN_GATE: [],
  BLOCKED: [],
};

export function canTransitionOrchestrationState(
  from: OrchestrationState,
  to: OrchestrationState,
): boolean {
  return FORWARD_TRANSITIONS[from].includes(to);
}

export function transitionOrchestrationState(
  from: OrchestrationState,
  to: OrchestrationState,
): OrchestrationState {
  if (!canTransitionOrchestrationState(from, to)) {
    throw new Error(`INVALID_ORCHESTRATION_TRANSITION:${from}->${to}`);
  }
  return to;
}

export function isTerminalOrchestrationState(state: OrchestrationState): boolean {
  return state === 'HUMAN_GATE' || state === 'BLOCKED';
}
