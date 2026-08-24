import { JsonCommandBuilderProvider, type JsonCommandProviderOptions } from './json-command-provider.js';
import type { BuilderProvider, CapturedProviderOutput } from './provider.js';
import type { BuilderRequest, BuilderResponse } from '../execution/managed-builder-runner.js';
import type { ProviderCommandConfig } from '../config/runtime-config.js';

/**
 * Trusted adapter around the active BuilderProvider protocol that runs
 * Claude Builder as an external JSON-in/JSON-out command inside the managed
 * workspace. It has no process engine of its own: it delegates every spawn
 * to JsonCommandBuilderProvider, the one process-spawning /
 * timeout-and-output-bounding / credential-firewall engine Commander uses
 * for every active provider, so this adapter cannot become a second
 * orchestration path.
 *
 * The same configured command handles both an initial build and a repair
 * attempt -- there is no separate repair execution path. The two requests
 * are explicitly distinguishable on the wire: a repair carries a `repair`
 * field (a RepairRequest, `kind: 'repair'`) that an initial BuilderRequest
 * never has (see src/orchestration/repair-request.ts).
 *
 * The configured command is opaque to Commander -- it must be an
 * operator-supplied executable that speaks the BuilderRequest/BuilderResponse
 * JSON contract on stdin/stdout (a wrapper around a real Claude CLI/runtime,
 * or, until one is configured, a deterministic test double). This adapter
 * never invents or assumes a live Claude call: if no executable is
 * configured it fails closed rather than pretending success.
 *
 * Claude never receives GitHub credentials (JsonCommandBuilderProvider's
 * environment firewall strips/forbids COMMANDER_GH_*, GITHUB_TOKEN and
 * GH_TOKEN) and never pushes to GitHub directly -- it only returns a
 * BuilderResponse describing its work; all publication happens later,
 * exclusively through Commander's own PublicationOrchestrator /
 * GitHubRestClient.
 */
export class ClaudeBuilderAdapter implements BuilderProvider<BuilderRequest, BuilderResponse> {
  public readonly mode = 'active' as const;
  public readonly name: string;
  private readonly delegate: JsonCommandBuilderProvider;

  public constructor(config: ProviderCommandConfig) {
    if (!config.executable || config.executable.trim() === '') {
      throw new Error('CLAUDE_BUILDER_COMMAND_REQUIRED');
    }
    this.name = config.name;
    const options: JsonCommandProviderOptions = {
      executable: config.executable,
      args: config.args,
      env: config.env,
      timeoutMs: config.timeoutMs,
      maxOutputBytes: config.maxOutputBytes,
    };
    this.delegate = new JsonCommandBuilderProvider(this.name, options);
  }

  public async build(input: BuilderRequest): Promise<CapturedProviderOutput<BuilderResponse>> {
    return this.delegate.build(input);
  }
}
