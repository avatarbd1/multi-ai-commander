import { JsonCommandReviewProvider, type JsonCommandProviderOptions } from './json-command-provider.js';
import type { ActiveReviewProvider, CapturedProviderOutput } from './provider.js';
import type { ReviewReport } from '../commander/types.js';
import type { IndependentReviewInput } from '../review/independent-reviewer-runner.js';
import type { ProviderCommandConfig } from '../config/runtime-config.js';

/**
 * Trusted adapter around the active ReviewProvider protocol for Commander's
 * independent reviewer. Like ClaudeBuilderAdapter, it has no process engine
 * of its own -- it delegates to JsonCommandReviewProvider, so builder and
 * reviewer share exactly one process-spawning/credential-firewall engine
 * rather than each growing a bespoke one.
 *
 * Isolation from the builder is structural, not just a naming convention:
 *  - Identity: IndependentReviewerRunner rejects a review whose provider
 *    name matches the builder's (REVIEWER_NOT_INDEPENDENT), and
 *    loadRuntimeConfigFromEnv already refuses to load a configuration where
 *    COMMANDER_BUILDER_NAME and COMMANDER_REVIEWER_NAME collide.
 *  - Workspace: JsonCommandReviewProvider never receives a workspacePath and
 *    never passes a `cwd` to the spawned process -- the reviewer command
 *    cannot see or write into the builder's checkout.
 *  - Evidence: the reviewer's input is exactly the remote PR diff fetched
 *    live via GitHubRestClient.getPullRequestDiff, the published BuilderOutput,
 *    and commit-bound CiEvidence (see IndependentReviewerRunner) -- never the
 *    builder's local workspace.
 *  - Credentials: the same COMMANDER_GH_-prefixed / GITHUB_TOKEN / GH_TOKEN
 *    environment firewall as the builder adapter applies; the reviewer
 *    command never receives GitHub credentials.
 *  - Coverage: IndependentReviewerRunner rejects a review that does not cover
 *    every acceptance criterion (REVIEW_COVERAGE_INCOMPLETE) before its
 *    report can reach a verdict.
 *
 * As with the builder adapter, the configured command must be an
 * operator-supplied executable speaking the reviewer JSON contract; this
 * adapter never fakes a live reviewer result when none is configured.
 */
export class IndependentReviewerAdapter implements ActiveReviewProvider<IndependentReviewInput, ReviewReport> {
  public readonly mode = 'active' as const;
  public readonly name: string;
  private readonly delegate: JsonCommandReviewProvider;

  public constructor(config: ProviderCommandConfig) {
    if (!config.executable || config.executable.trim() === '') {
      throw new Error('INDEPENDENT_REVIEWER_COMMAND_REQUIRED');
    }
    this.name = config.name;
    const options: JsonCommandProviderOptions = {
      executable: config.executable,
      args: config.args,
      env: config.env,
      timeoutMs: config.timeoutMs,
      maxOutputBytes: config.maxOutputBytes,
    };
    this.delegate = new JsonCommandReviewProvider(this.name, options);
  }

  public async review(input: IndependentReviewInput): Promise<CapturedProviderOutput<ReviewReport>> {
    return this.delegate.review(input);
  }
}
