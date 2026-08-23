import type { CapturedProviderOutput, ReviewProvider } from './provider.js';

/**
 * Phase-1 provider: records an independently produced AI review without making
 * paid model API calls. API-backed adapters are deliberately deferred.
 */
export class CapturedReviewProvider<TInput, TOutput> implements ReviewProvider<TInput, TOutput> {
  public constructor(
    public readonly name: string,
    private readonly captured: TOutput,
    private readonly sourceReference?: string,
  ) {}

  public async review(_input: TInput): Promise<CapturedProviderOutput<TOutput>> {
    return Promise.resolve({
      provider: this.name,
      capturedAt: new Date().toISOString(),
      payload: this.captured,
      ...(this.sourceReference ? { sourceReference: this.sourceReference } : {}),
    });
  }
}
