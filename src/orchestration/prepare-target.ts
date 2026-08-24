import type { GitHubRestClient } from '../github/client.js';
import { verifyLiveTargetAccess, type TargetAccessResult } from './live-target-access.js';
import {
  transitionOrchestrationState,
  type OrchestrationState,
} from './state-machine.js';
import { resolveTargetRepository, type TargetLock } from './target-resolver.js';

export interface TargetPreparationResult {
  state: OrchestrationState;
  target?: TargetLock;
  access?: TargetAccessResult;
  errorCode?: 'UNSUPPORTED_TARGET_REPOSITORY';
}

export async function prepareTargetForBuild(
  client: Pick<GitHubRestClient, 'getRepository'>,
  input: string,
): Promise<TargetPreparationResult> {
  let state: OrchestrationState = 'TASK';
  state = transitionOrchestrationState(state, 'TARGET_LOCK');

  let target: TargetLock;
  try {
    target = resolveTargetRepository(input);
  } catch {
    return {
      state: transitionOrchestrationState(state, 'BLOCKED'),
      errorCode: 'UNSUPPORTED_TARGET_REPOSITORY',
    };
  }

  state = transitionOrchestrationState(state, 'TARGET_ACCESS_VERIFY');
  const access = await verifyLiveTargetAccess(client, target);
  if (!access.authorized) {
    return {
      state: transitionOrchestrationState(state, 'BLOCKED'),
      target,
      access,
    };
  }

  return {
    state: transitionOrchestrationState(state, 'BUILD'),
    target,
    access,
  };
}
