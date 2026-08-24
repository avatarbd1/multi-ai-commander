/**
 * Structured request sent to the configured planner command. `kind: 'plan'`
 * makes this explicitly distinguishable from a Builder/Reviewer request on
 * the wire, matching the pattern RepairRequest already uses
 * (kind: 'repair') to keep provider protocols unambiguous.
 *
 * The planner receives everything it needs to bound its own output --
 * the Owner's natural-language command, an optional target hint, the full
 * operating constitution text (its behavioral contract), the list of
 * repository aliases Commander actually supports, and a short guide to the
 * required TaskContract shape -- and nothing else. It never receives
 * GitHub credentials, a workspace, or any execution capability: it is a
 * pure text-in/JSON-out step, sandboxed by the same process engine
 * (JsonCommandPlannerProvider / runJsonCommand) as the Builder and
 * Reviewer.
 */
export interface PlannerRequest {
  kind: 'plan';
  command: string;
  target?: string;
  operatingConstitution: string;
  supportedTargets: string[];
  taskContractGuide: {
    requiredFields: string[];
    riskLevels: string[];
  };
}
