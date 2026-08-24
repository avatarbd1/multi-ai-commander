import type { GitHubRestClient } from '../github/client.js';
import { BranchProtectionVerifier, mapGitHubBranchProtectionResponse } from './branch-protection-policy.js';

export interface InstallationRequirements {
  minContentsPermission: 'read' | 'write' | 'admin';
  minPullRequestsPermission: 'read' | 'write' | 'admin';
  minChecksPermission: 'read' | 'write' | 'admin';
  requireBranchProtection: boolean;
  requiredBranch: string;
}

export const DEFAULT_REQUIREMENTS: InstallationRequirements = {
  minContentsPermission: 'write',
  minPullRequestsPermission: 'write',
  minChecksPermission: 'read',
  requireBranchProtection: true,
  requiredBranch: 'main',
};

const PERMISSION_RANK: Record<string, number> = { read: 1, write: 2, admin: 3 };

function meetsMinimumPermission(actual: string | undefined, minimum: string): boolean {
  const actualRank = actual ? (PERMISSION_RANK[actual] ?? 0) : 0;
  const minimumRank = PERMISSION_RANK[minimum] ?? Number.MAX_SAFE_INTEGER;
  return actualRank >= minimumRank;
}

/**
 * Case-insensitive EXACT match of a GitHub "owner/repo" identity string.
 * Deliberately not a substring/`includes` check: `evil-org/repo` and
 * `org/repository` must never be treated as matching `org/repo`.
 */
export function repositoryIdentitiesMatch(expected: string, actual: string): boolean {
  return expected.trim().toLowerCase() === actual.trim().toLowerCase();
}

export class LiveInstallationVerifier {
  public static async verify(
    client: GitHubRestClient,
    repository: string,
    installationId: number,
    requirements: InstallationRequirements = DEFAULT_REQUIREMENTS,
  ): Promise<{ satisfied: boolean; violations: string[] }> {
    const violations: string[] = [];

    if (client.installationId !== installationId) {
      violations.push('Installation ID mismatch between verification request and authenticated client');
      return { satisfied: false, violations };
    }

    try {
      const repo = await client.getRepository(repository);
      if (!repositoryIdentitiesMatch(repository, repo.fullName)) {
        violations.push('Repository access failed: resolved repository does not match requested repository');
      }
    } catch (error) {
      violations.push(`Repository access verification failed: ${error instanceof Error ? '[REDACTED]' : 'unknown error'}`);
    }

    try {
      const permissions = await client.getInstallationPermissions();
      if (!meetsMinimumPermission(permissions.contents, requirements.minContentsPermission)) {
        violations.push(
          `Installation permission 'contents' is '${permissions.contents ?? 'none'}', requires at least '${requirements.minContentsPermission}'`,
        );
      }
      if (!meetsMinimumPermission(permissions.pull_requests, requirements.minPullRequestsPermission)) {
        violations.push(
          `Installation permission 'pull_requests' is '${permissions.pull_requests ?? 'none'}', requires at least '${requirements.minPullRequestsPermission}'`,
        );
      }
      if (!meetsMinimumPermission(permissions.checks, requirements.minChecksPermission)) {
        violations.push(
          `Installation permission 'checks' is '${permissions.checks ?? 'none'}', requires at least '${requirements.minChecksPermission}'`,
        );
      }
    } catch (error) {
      violations.push(`Installation permission verification failed: ${error instanceof Error ? '[REDACTED]' : 'unknown error'}`);
    }

    if (requirements.requireBranchProtection) {
      try {
        const rawPolicy = await client.getBranchProtectionPolicy(repository, requirements.requiredBranch);
        if (!rawPolicy) {
          violations.push(`Branch protection not enforced on ${requirements.requiredBranch}`);
        } else {
          const policy = mapGitHubBranchProtectionResponse(repository, requirements.requiredBranch, rawPolicy);
          const verification = BranchProtectionVerifier.verify(policy);
          if (!verification.satisfied) {
            violations.push(...verification.violations.map((v) => `Branch protection: ${v}`));
          }
        }
      } catch (error) {
        violations.push(
          `Branch protection verification failed: ${error instanceof Error ? '[REDACTED]' : 'unknown error'}`,
        );
      }
    }

    return {
      satisfied: violations.length === 0,
      violations,
    };
  }

  public static failClosed(
    result: { satisfied: boolean; violations: string[] },
  ): { allowed: boolean; reason?: string } {
    if (!result.satisfied) {
      return {
        allowed: false,
        reason: `Installation verification failed: ${result.violations.join('; ')}`,
      };
    }
    return { allowed: true };
  }
}
