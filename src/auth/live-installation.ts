import type { GitHubRestClient } from '../github/client.js';
import type { BranchProtectionPolicy } from './branch-protection-policy.js';
import { BranchProtectionVerifier } from './branch-protection-policy.js';

export interface InstallationPermissions {
  repository: string;
  installationId: number;
  permissions: {
    pull: 'read' | 'write' | 'admin';
    push: 'read' | 'write' | 'admin';
    contents: 'read' | 'write' | 'admin';
    checks: 'read' | 'write' | 'admin';
  };
}

export interface InstallationRequirements {
  minPullPermission: 'read' | 'write' | 'admin';
  minPushPermission: 'read' | 'write' | 'admin';
  minContentsPermission: 'read' | 'write' | 'admin';
  minChecksPermission: 'read' | 'write';
  requireBranchProtection: boolean;
  requiredBranch: string;
}

export const DEFAULT_REQUIREMENTS: InstallationRequirements = {
  minPullPermission: 'read',
  minPushPermission: 'write',
  minContentsPermission: 'write',
  minChecksPermission: 'read',
  requireBranchProtection: true,
  requiredBranch: 'main',
};

export class LiveInstallationVerifier {
  public static async verify(
    client: GitHubRestClient,
    repository: string,
    installationId: number,
    requirements: InstallationRequirements = DEFAULT_REQUIREMENTS,
  ): Promise<{ satisfied: boolean; violations: string[] }> {
    const violations: string[] = [];

    try {
      const repo = await client.getRepository(repository);
      if (!repo.fullName.toLowerCase().includes(repository.toLowerCase())) {
        violations.push('Repository access failed: cannot read repository');
      }
    } catch (error) {
      violations.push(`Repository access verification failed: ${error instanceof Error ? '[REDACTED]' : 'unknown error'}`);
    }

    if (requirements.requireBranchProtection) {
      try {
        const policy = await client.getBranchProtectionPolicy(repository, requirements.requiredBranch);
        if (!policy) {
          violations.push(`Branch protection not enforced on ${requirements.requiredBranch}`);
        } else {
          const verification = BranchProtectionVerifier.verify(policy as any);
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
