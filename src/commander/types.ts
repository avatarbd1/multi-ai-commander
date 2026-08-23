export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type Verdict = 'PASS' | 'NEEDS_FIX' | 'BLOCKED';
export type CheckConclusion = 'success' | 'failure' | 'cancelled' | 'skipped' | 'neutral' | 'pending';

export interface AcceptanceCriterion {
  id: string;
  requirement: string;
  evidenceRequired: string[];
}

export interface TaskContract {
  id: string;
  title: string;
  targetRepository: string;
  baseBranch: string;
  objective: string;
  acceptanceCriteria: AcceptanceCriterion[];
  constraints: string[];
  riskLevel: RiskLevel;
  productionMutationAllowed: boolean;
}

export interface TestResult {
  name: string;
  command: string;
  conclusion: CheckConclusion;
  evidence?: string;
}

export interface BuilderOutput {
  taskId: string;
  provider: string;
  summary: string;
  branch: string;
  commitSha: string;
  pullRequestNumber?: number;
  changedFiles: string[];
  tests: TestResult[];
  knownLimitations: string[];
}

export type FindingSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type FindingCategory = 'requirements' | 'bug' | 'security' | 'regression' | 'test' | 'architecture';

export interface ReviewFinding {
  id: string;
  severity: FindingSeverity;
  category: FindingCategory;
  message: string;
  evidence?: string;
  file?: string;
  line?: number;
}

export interface RequirementReview {
  criterionId: string;
  satisfied: boolean;
  evidence: string[];
  notes?: string;
}

export interface ReviewReport {
  taskId: string;
  provider: string;
  independentFromBuilder: boolean;
  findings: ReviewFinding[];
  requirements: RequirementReview[];
  recommendation: 'approve' | 'changes_requested' | 'blocked';
}

export interface CiCheck {
  name: string;
  conclusion: CheckConclusion;
  url?: string;
}

export interface CiEvidence {
  commitSha: string;
  checks: CiCheck[];
}

export interface CommanderDecision {
  taskId: string;
  verdict: Verdict;
  reasons: string[];
  humanGateRequired: true;
  automaticProductionDeploy: false;
  evaluatedAt: string;
}
