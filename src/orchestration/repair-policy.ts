export interface RepairPolicy {
  readonly maxRepairCycles: number;
}

export const DEFAULT_MAX_REPAIR_CYCLES = 2;
export const HARD_MAX_REPAIR_CYCLES = 3;

/**
 * Builds a bounded repair policy. Fails closed: an out-of-range or
 * non-integer value throws rather than clamping silently, so a
 * misconfigured environment stops the run instead of quietly running with
 * an unintended (and possibly unlimited) retry budget. There is no way to
 * request more than HARD_MAX_REPAIR_CYCLES repair attempts through this
 * constructor.
 */
export function createRepairPolicy(maxRepairCycles: number = DEFAULT_MAX_REPAIR_CYCLES): RepairPolicy {
  if (
    !Number.isSafeInteger(maxRepairCycles) ||
    maxRepairCycles < 0 ||
    maxRepairCycles > HARD_MAX_REPAIR_CYCLES
  ) {
    throw new Error(
      `COMMANDER_MAX_REPAIR_CYCLES must be an integer between 0 and ${HARD_MAX_REPAIR_CYCLES}`,
    );
  }
  return { maxRepairCycles };
}
