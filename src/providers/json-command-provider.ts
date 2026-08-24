import { spawn } from 'node:child_process';
import type { ReviewReport } from '../commander/types.js';
import type {
  ActiveReviewProvider,
  BuilderProvider,
  CapturedProviderOutput,
} from './provider.js';
import type { BuilderRequest, BuilderResponse } from '../execution/managed-builder-runner.js';
import type { IndependentReviewInput } from '../review/independent-reviewer-runner.js';

export interface JsonCommandProviderOptions {
  executable: string;
  args?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

const SAFE_ENV_KEYS = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot'] as const;

function buildEnvironment(extra: Record<string, string> | undefined): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of SAFE_ENV_KEYS) {
    const value = process.env[key];
    if (value) environment[key] = value;
  }
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (/^(?:COMMANDER_GH_|GITHUB_TOKEN$|GH_TOKEN$)/i.test(key)) {
      throw new Error(`FORBIDDEN_PROVIDER_ENV_KEY:${key}`);
    }
    environment[key] = value;
  }
  return environment;
}

async function runJsonCommand<TInput, TOutput>(
  options: JsonCommandProviderOptions,
  input: TInput,
  cwd?: string,
): Promise<TOutput> {
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  const maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024;

  return new Promise<TOutput>((resolve, reject) => {
    const child = spawn(options.executable, options.args ?? [], {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildEnvironment(options.env),
      ...(cwd ? { cwd } : {}),
    });

    let stdout = '';
    let stderrBytes = 0;
    let outputTooLarge = false;
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('PROVIDER_COMMAND_TIMEOUT'));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (outputTooLarge) return;
      stdout += chunk;
      if (Buffer.byteLength(stdout, 'utf8') > maxOutputBytes) {
        outputTooLarge = true;
        child.kill('SIGKILL');
      }
    });
    child.stderr.on('data', (chunk: Uint8Array) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > maxOutputBytes) child.kill('SIGKILL');
    });
    child.on('error', () => {
      clearTimeout(timeout);
      reject(new Error('PROVIDER_COMMAND_START_FAILED'));
    });
    child.on('close', (code: number | null) => {
      clearTimeout(timeout);
      if (outputTooLarge || stderrBytes > maxOutputBytes) {
        reject(new Error('PROVIDER_COMMAND_OUTPUT_LIMIT'));
        return;
      }
      if (code !== 0) {
        reject(new Error(`PROVIDER_COMMAND_FAILED:${code ?? 'signal'}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as TOutput);
      } catch {
        reject(new Error('PROVIDER_COMMAND_INVALID_JSON'));
      }
    });

    child.stdin.end(JSON.stringify(input));
  });
}

export class JsonCommandBuilderProvider implements BuilderProvider<BuilderRequest, BuilderResponse> {
  public readonly mode = 'active' as const;

  public constructor(
    public readonly name: string,
    private readonly options: JsonCommandProviderOptions,
  ) {}

  public async build(input: BuilderRequest): Promise<CapturedProviderOutput<BuilderResponse>> {
    const payload = await runJsonCommand<BuilderRequest, BuilderResponse>(this.options, input, input.workspacePath);
    return {
      provider: this.name,
      capturedAt: new Date().toISOString(),
      payload,
    };
  }
}

export class JsonCommandReviewProvider implements ActiveReviewProvider<IndependentReviewInput, ReviewReport> {
  public readonly mode = 'active' as const;

  public constructor(
    public readonly name: string,
    private readonly options: JsonCommandProviderOptions,
  ) {}

  public async review(input: IndependentReviewInput): Promise<CapturedProviderOutput<ReviewReport>> {
    const payload = await runJsonCommand<IndependentReviewInput, ReviewReport>(this.options, input);
    return {
      provider: this.name,
      capturedAt: new Date().toISOString(),
      payload,
    };
  }
}
