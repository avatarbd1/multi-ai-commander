import { JsonCommandPlannerProvider, type JsonCommandProviderOptions } from './json-command-provider.js';
import type { CapturedProviderOutput, PlannerProvider } from './provider.js';
import type { TaskContract } from '../commander/types.js';
import type { PlannerRequest } from '../planner/planner-request.js';
import type { ProviderCommandConfig } from '../config/runtime-config.js';

/**
 * Trusted adapter over the Goal -> TaskContract planner protocol. Like the
 * Builder and Reviewer adapters, it has no process engine of its own -- it
 * delegates to JsonCommandPlannerProvider, so planning shares the exact
 * same process-spawning/timeout/output-bounding/credential-firewall engine
 * as everything else Commander invokes, rather than growing a bespoke one.
 *
 * The configured command must be an operator-supplied executable speaking
 * the PlannerRequest / TaskContract JSON contract on stdin/stdout (a
 * wrapper around a real planning model, or a deterministic test double).
 * This adapter never fakes a live planning result when none is configured:
 * with no executable set it fails closed (PLANNER_COMMAND_REQUIRED).
 *
 * The planner never receives GitHub credentials, a Builder workspace, or
 * any execution capability -- it can only return JSON, which the caller
 * (src/planner/plan-task.ts) then normalizes and validates exactly as it
 * would a human-authored task file before treating it as a real
 * TaskContract.
 */
export class PlannerAdapter implements PlannerProvider<PlannerRequest, TaskContract> {
  public readonly mode = 'active' as const;
  public readonly name: string;
  private readonly delegate: JsonCommandPlannerProvider;

  public constructor(config: ProviderCommandConfig) {
    if (!config.executable || config.executable.trim() === '') {
      throw new Error('PLANNER_COMMAND_REQUIRED');
    }
    this.name = config.name;
    const options: JsonCommandProviderOptions = {
      executable: config.executable,
      args: config.args,
      env: config.env,
      timeoutMs: config.timeoutMs,
      maxOutputBytes: config.maxOutputBytes,
    };
    this.delegate = new JsonCommandPlannerProvider(this.name, options);
  }

  public async plan(input: PlannerRequest): Promise<CapturedProviderOutput<TaskContract>> {
    return this.delegate.plan(input);
  }
}
