import type { CiEvidence } from '../commander/types.js';
import type { GitHubRestClient } from '../github/client.js';

export type CiGateCode = 'CI_PASS' | 'CI_SHA_MISMATCH' | 'CI_MISSING' | 'CI_PENDING' | 'CI_NOT_SUCCESS';

export interface CiGateResult {
  passed: boolean;
  code: CiGateCode;
  evidence: CiEvidence;
}

export function evaluateCommitBoundCi(expectedSha: string, evidence: CiEvidence): CiGateResult {
  if (evidence.commitSha.toLowerCase() !== expectedSha.toLowerCase()) {
    return { passed: false, code: 'CI_SHA_MISMATCH', evidence };
  }
  if (evidence.checks.length === 0) return { passed: false, code: 'CI_MISSING', evidence };
  if (evidence.checks.some((check) => check.conclusion === 'pending')) {
    return { passed: false, code: 'CI_PENDING', evidence };
  }
  if (evidence.checks.some((check) => check.conclusion !== 'success')) {
    return { passed: false, code: 'CI_NOT_SUCCESS', evidence };
  }
  return { passed: true, code: 'CI_PASS', evidence };
}

export interface CiWaitOptions {
  maxAttempts?: number;
  intervalMs?: number;
}

export async function waitForCommitBoundCi(
  client: Pick<GitHubRestClient, 'getCiEvidence'>,
  repository: string,
  expectedSha: string,
  options: CiWaitOptions = {},
): Promise<CiGateResult> {
  const maxAttempts = options.maxAttempts ?? 30;
  const intervalMs = options.intervalMs ?? 10_000;
  let latest: CiGateResult | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const evidence = await client.getCiEvidence(repository, expectedSha);
    latest = evaluateCommitBoundCi(expectedSha, evidence);
    if (latest.passed || (latest.code !== 'CI_MISSING' && latest.code !== 'CI_PENDING')) return latest;
    if (attempt + 1 < maxAttempts) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return latest ?? {
    passed: false,
    code: 'CI_MISSING',
    evidence: { commitSha: expectedSha, checks: [] },
  };
}
