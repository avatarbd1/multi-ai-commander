import type { FileChange } from '../execution/managed-builder-runner.js';

/**
 * Deterministic fingerprint of one attempt, used to detect a repair cycle
 * that made no real progress. `changeSignature` captures exactly what the
 * builder produced (path, add/modify/delete, and a content hash so an
 * unchanged file with unchanged content collapses to the same signature
 * every attempt); `outcomeSignature` captures the failure that triggered
 * the repair (failing check names/conclusions, or reviewer/verdict
 * reasons). Both are plain, bounded strings -- not raw logs -- built from
 * data already present on the attempt's own results.
 *
 * This is intentionally deterministic and mechanical (string/hash
 * equality), not an LLM judgment call: it is the loop's actual safety
 * mechanism against retrying forever on a repair that changes nothing.
 */
export interface AttemptFingerprint {
  changeSignature: string;
  outcomeSignature: string;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function fingerprintChanges(changes: readonly FileChange[]): Promise<string> {
  const sorted = [...changes].sort((a, b) => a.path.localeCompare(b.path));
  const parts = await Promise.all(
    sorted.map(async (change) => `${change.status}:${change.path}:${change.content ? await sha256Hex(change.content) : ''}`),
  );
  return parts.join('|');
}

export function fingerprintOutcome(parts: ReadonlyArray<string | undefined>): string {
  return parts.filter((part): part is string => Boolean(part && part.length > 0)).join('||');
}

/**
 * True when the current attempt's changeset AND failure outcome are both
 * byte-identical to the immediately preceding attempt -- i.e. the repair
 * changed nothing material and hit the same wall again. A change in either
 * dimension (different diff, or different failure) is treated as progress
 * and allowed to continue, up to the repair policy's own limit.
 */
export function isNoProgress(previous: AttemptFingerprint | undefined, current: AttemptFingerprint): boolean {
  if (!previous) return false;
  return previous.changeSignature === current.changeSignature && previous.outcomeSignature === current.outcomeSignature;
}
