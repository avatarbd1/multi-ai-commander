import type { GitHubRestClient } from '../github/client.js';
import type { TargetLock } from './target-resolver.js';

export type TargetAccessCode =
  | 'LIVE_TARGET_ACCESS_VERIFIED'
  | 'TARGET_REPOSITORY_NOT_AUTHORIZED';

export interface TargetAccessResult {
  repository: string;
  authorized: boolean;
  code: TargetAccessCode;
  observedRepository?: string;
}

export async function verifyLiveTargetAccess(
  client: Pick<GitHubRestClient, 'getRepository'>,
  target: TargetLock,
): Promise<TargetAccessResult> {
  try {
    const repository = await client.getRepository(target.repository);
    const authorized = repository.fullName.toLowerCase() === target.repository.toLowerCase();

    if (!authorized) {
      return {
        repository: target.repository,
        authorized: false,
        code: 'TARGET_REPOSITORY_NOT_AUTHORIZED',
        observedRepository: repository.fullName,
      };
    }

    return {
      repository: target.repository,
      authorized: true,
      code: 'LIVE_TARGET_ACCESS_VERIFIED',
      observedRepository: repository.fullName,
    };
  } catch {
    return {
      repository: target.repository,
      authorized: false,
      code: 'TARGET_REPOSITORY_NOT_AUTHORIZED',
    };
  }
}
