export interface CapturedProviderOutput<T> {
  provider: string;
  capturedAt: string;
  payload: T;
  sourceReference?: string;
}

export interface ReviewProvider<TInput, TOutput> {
  readonly name: string;
  readonly mode?: 'captured' | 'active';
  review(input: TInput): Promise<CapturedProviderOutput<TOutput>>;
}

export interface ActiveReviewProvider<TInput, TOutput> extends ReviewProvider<TInput, TOutput> {
  readonly mode: 'active';
}

export interface BuilderProvider<TInput, TOutput> {
  readonly name: string;
  readonly mode: 'active';
  build(input: TInput): Promise<CapturedProviderOutput<TOutput>>;
}
