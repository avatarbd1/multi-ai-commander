import type { BuilderOutput, CiEvidence, CommanderDecision, ReviewReport, TaskContract } from './types.js';
import { evaluateCommanderDecision } from './verdict.js';
import { AuditChain } from '../audit/hash-chain.js';

export interface CommanderRunInput {
  task: TaskContract;
  builder: BuilderOutput;
  review: ReviewReport;
  ci: CiEvidence;
  now?: string;
}

export interface CommanderRunResult {
  decision: CommanderDecision;
  audit: AuditChain;
}

export async function runCommander(input: CommanderRunInput): Promise<CommanderRunResult> {
  const audit = new AuditChain();
  const timestamp = input.now ?? new Date().toISOString();
  await audit.append('task.contract', input.task, timestamp);
  await audit.append('builder.output', input.builder, timestamp);
  await audit.append('review.report', input.review, timestamp);
  await audit.append('ci.evidence', input.ci, timestamp);
  const decision = evaluateCommanderDecision(input);
  await audit.append('commander.verdict', decision, timestamp);
  return { decision, audit };
}
